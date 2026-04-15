import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ChatEvent, SessionMeta, SessionSnapshot } from '@shared/models'
import { getDatabase } from '../lib/database'
import { ensureChatSchema } from './sqlite-schema'

export const DEFAULT_SESSION_TITLE = 'New chat'

type SessionStoreOptions = {
  database?: Database.Database
}

const compactText = (value: string): string => value.replace(/\s+/g, ' ').trim()

export const clampSessionTitle = (value: string): string => {
  const normalized = compactText(value)
  if (!normalized) {
    return ''
  }

  return normalized.length > 60 ? `${normalized.slice(0, 59)}…` : normalized
}

export const fallbackTitleFromUserText = (value: string, timestamp = Date.now()): string => {
  const candidate = clampSessionTitle(value)

  if (candidate) {
    return candidate
  }

  return `Chat ${new Date(timestamp).toLocaleString()}`
}

export const sortSessionsByUpdatedAt = (sessions: SessionMeta[]): SessionMeta[] =>
  [...sessions].sort((left, right) => right.updatedAt - left.updatedAt)

export const selectRecentSessions = (sessions: SessionMeta[], limit = 10): SessionMeta[] =>
  sortSessionsByUpdatedAt(sessions).slice(0, limit)

const parseSessionMeta = (row: {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  status: SessionMeta['status']
}): SessionMeta => ({
  id: row.id,
  title: row.title,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  messageCount: row.messageCount,
  status: row.status
})

const extractSearchableText = (event: ChatEvent): string => {
  if (event.type === 'user.message') {
    return event.text
  }

  if (event.type === 'assistant.completed') {
    return event.text
  }

  return ''
}

const sanitizeFtsQuery = (query: string): string => {
  const terms = query
    .trim()
    .replace(/["']/g, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)

  if (terms.length === 0) {
    return ''
  }

  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' AND ')
}

export class ChatSessionStore {
  private readonly db: Database.Database

  constructor(options: SessionStoreOptions = {}) {
    this.db = options.database ?? getDatabase()
    ensureChatSchema(this.db)
  }

  async createSession(sessionId: string = randomUUID()): Promise<SessionMeta> {
    const now = Date.now()
    const meta: SessionMeta = {
      id: sessionId,
      title: DEFAULT_SESSION_TITLE,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      status: 'idle'
    }
    const event: ChatEvent = {
      type: 'session.created',
      eventId: `session.created_${randomUUID()}`,
      sessionId,
      timestamp: now,
      meta
    }

    const transaction = this.db.transaction((nextMeta: SessionMeta, nextEvent: ChatEvent) => {
      this.db
        .prepare(
          `
          INSERT INTO chat_sessions (id, title, createdAt, updatedAt, messageCount, status)
          VALUES (@id, @title, @createdAt, @updatedAt, @messageCount, @status)
          `
        )
        .run(nextMeta)

      this.db
        .prepare(
          `
          INSERT INTO chat_events (sessionId, eventId, timestamp, type, searchableText, payload)
          VALUES (@sessionId, @eventId, @timestamp, @type, @searchableText, @payload)
          `
        )
        .run({
          sessionId: nextEvent.sessionId,
          eventId: nextEvent.eventId,
          timestamp: nextEvent.timestamp,
          type: nextEvent.type,
          searchableText: extractSearchableText(nextEvent),
          payload: JSON.stringify(nextEvent)
        })
    })

    transaction(meta, event)

    return meta
  }

  async readMeta(sessionId: string): Promise<SessionMeta> {
    const row = this.db
      .prepare(
        `
        SELECT id, title, createdAt, updatedAt, messageCount, status
        FROM chat_sessions
        WHERE id = ?
        `
      )
      .get(sessionId) as
      | {
          id: string
          title: string
          createdAt: number
          updatedAt: number
          messageCount: number
          status: SessionMeta['status']
        }
      | undefined

    if (!row) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    return parseSessionMeta(row)
  }

  async updateMeta(
    sessionId: string,
    update: Partial<SessionMeta> | ((current: SessionMeta) => SessionMeta)
  ): Promise<SessionMeta> {
    const current = await this.readMeta(sessionId)
    const next = typeof update === 'function' ? update(current) : { ...current, ...update }
    this.db
      .prepare(
        `
        UPDATE chat_sessions
        SET title = @title, createdAt = @createdAt, updatedAt = @updatedAt, messageCount = @messageCount, status = @status
        WHERE id = @id
        `
      )
      .run(next)
    return next
  }

  async appendEvent(sessionId: string, event: ChatEvent): Promise<void> {
    this.db
      .prepare(
        `
        INSERT INTO chat_events (sessionId, eventId, timestamp, type, searchableText, payload)
        VALUES (@sessionId, @eventId, @timestamp, @type, @searchableText, @payload)
        `
      )
      .run({
        sessionId,
        eventId: event.eventId,
        timestamp: event.timestamp,
        type: event.type,
        searchableText: extractSearchableText(event),
        payload: JSON.stringify(event)
      })
  }

  async readEvents(sessionId: string): Promise<ChatEvent[]> {
    const rows = this.db
      .prepare(
        `
        SELECT payload
        FROM chat_events
        WHERE sessionId = ?
        ORDER BY timestamp ASC, id ASC
        `
      )
      .all(sessionId) as { payload: string }[]

    return rows.map((row) => JSON.parse(row.payload) as ChatEvent)
  }

  async openSession(sessionId: string): Promise<SessionSnapshot> {
    const [meta, events] = await Promise.all([this.readMeta(sessionId), this.readEvents(sessionId)])
    return { meta, events }
  }

  async listSessions(): Promise<SessionMeta[]> {
    const rows = this.db
      .prepare(
        `
        SELECT id, title, createdAt, updatedAt, messageCount, status
        FROM chat_sessions
        ORDER BY updatedAt DESC
        `
      )
      .all() as Array<{
      id: string
      title: string
      createdAt: number
      updatedAt: number
      messageCount: number
      status: SessionMeta['status']
    }>

    return rows.map(parseSessionMeta)
  }

  async searchSessions(query: string): Promise<SessionMeta[]> {
    const normalized = query.trim()
    if (!normalized) {
      return this.listSessions()
    }

    const matchQuery = sanitizeFtsQuery(normalized)
    if (!matchQuery) {
      return []
    }

    const rows = this.db
      .prepare(
        `
        SELECT DISTINCT s.id, s.title, s.createdAt, s.updatedAt, s.messageCount, s.status
        FROM chat_events_fts fts
        INNER JOIN chat_events events ON events.id = fts.rowid
        INNER JOIN chat_sessions s ON s.id = events.sessionId
        WHERE chat_events_fts MATCH ?
        ORDER BY s.updatedAt DESC
        `
      )
      .all(matchQuery) as Array<{
      id: string
      title: string
      createdAt: number
      updatedAt: number
      messageCount: number
      status: SessionMeta['status']
    }>

    return rows.map(parseSessionMeta)
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<SessionMeta> {
    const safeTitle = clampSessionTitle(title)
    if (!safeTitle) {
      throw new Error('Session title cannot be empty.')
    }

    return this.updateMeta(sessionId, {
      title: safeTitle,
      updatedAt: Date.now()
    })
  }

  async deleteSession(sessionId: string): Promise<void> {
    const transaction = this.db.transaction((targetSessionId: string) => {
      this.db.prepare('DELETE FROM chat_events WHERE sessionId = ?').run(targetSessionId)
      this.db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(targetSessionId)
    })

    transaction(sessionId)
  }
}
