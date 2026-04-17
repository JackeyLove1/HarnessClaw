import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { ChatEvent, SessionMeta, SessionSnapshot } from '@shared/models'
import type {
  SkillUsageRecord,
  ToolCallUsageRecord,
  ToolStatsRecord,
  UsageOverview,
  UsageRecord,
  UsageRecordKind
} from '@shared/types'
import {
  compareToolPriorityMetrics,
  getEffectiveToolPriority,
  getToolPriority
} from '../agent/tools/priorities'
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

type UsageRecordInput = {
  sessionId?: string | null
  assistantMessageId?: string | null
  requestRound: number
  kind: UsageRecordKind
  model: string
  inputTokens?: number
  outputTokens?: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
  timestamp?: number
}

type UsageRow = {
  id: string
  sessionId: string | null
  title: string | null
  assistantMessageId: string | null
  requestRound: number
  kind: UsageRecordKind
  model: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  timestamp: number
}

const rowToUsageRecord = (row: UsageRow): UsageRecord => {
  const totalTokens =
    row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens
  return {
    id: row.id,
    sessionId: row.sessionId,
    sessionTitle: row.title,
    assistantMessageId: row.assistantMessageId,
    requestRound: row.requestRound,
    kind: row.kind,
    model: row.model,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    cacheReadTokens: row.cacheReadTokens,
    totalTokens,
    timestamp: row.timestamp
  }
}

type ToolUsageRecordInput = {
  toolCallId: string
  sessionId?: string | null
  assistantMessageId?: string | null
  requestRound: number
  toolName: string
  callType: 'tool' | 'mcp'
  status: 'success' | 'error'
  durationMs: number
  argsSummary?: string
  outputSummary?: string
  roundInputTokens?: number
  roundOutputTokens?: number
  roundCacheCreationTokens?: number
  roundCacheReadTokens?: number
  roundToolCallCount?: number
  timestamp?: number
}

type SkillUsageRecordInput = {
  sessionId?: string | null
  assistantMessageId: string
  requestRound: number
  toolCallId: string
  skillId: string
  skillName: string
  skillFilePath: string
  timestamp?: number
}

type ToolStatsRow = {
  toolName: string
  callType: 'tool' | 'mcp'
  useCount: number
  successCount: number
  errorCount: number
  totalDurationMs: number
  averageDurationMs: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheCreationTokens: number
  totalCacheReadTokens: number
  lastUsedAt: number | null
}

const asRoundedMetric = (value: number): number => Math.max(0, Math.round(value))

const rowToToolStatsRecord = (row: ToolStatsRow): ToolStatsRecord => {
  const basePriority = getToolPriority(row.toolName)
  const totalInputTokens = asRoundedMetric(row.totalInputTokens)
  const totalOutputTokens = asRoundedMetric(row.totalOutputTokens)
  const totalCacheCreationTokens = asRoundedMetric(row.totalCacheCreationTokens)
  const totalCacheReadTokens = asRoundedMetric(row.totalCacheReadTokens)

  return {
    toolName: row.toolName,
    callType: row.callType,
    basePriority,
    effectivePriority: getEffectiveToolPriority(row.toolName, row.useCount, basePriority),
    useCount: row.useCount,
    successCount: row.successCount,
    errorCount: row.errorCount,
    totalDurationMs: row.totalDurationMs,
    averageDurationMs: asRoundedMetric(row.averageDurationMs),
    totalInputTokens,
    totalOutputTokens,
    totalCacheCreationTokens,
    totalCacheReadTokens,
    totalTokens:
      totalInputTokens +
      totalOutputTokens +
      totalCacheCreationTokens +
      totalCacheReadTokens,
    lastUsedAt: row.lastUsedAt
  }
}

type ToolEventPayload = Extract<ChatEvent, { type: 'tool.called' | 'tool.completed' }>

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

  async appendUsageRecord(record: UsageRecordInput): Promise<void> {
    this.db
      .prepare(
        `
        INSERT INTO chat_usage_records (
          id,
          sessionId,
          assistantMessageId,
          requestRound,
          kind,
          model,
          inputTokens,
          outputTokens,
          cacheCreationTokens,
          cacheReadTokens,
          timestamp
        )
        VALUES (
          @id,
          @sessionId,
          @assistantMessageId,
          @requestRound,
          @kind,
          @model,
          @inputTokens,
          @outputTokens,
          @cacheCreationTokens,
          @cacheReadTokens,
          @timestamp
        )
        `
      )
      .run({
        id: randomUUID(),
        sessionId: record.sessionId ?? null,
        assistantMessageId: record.assistantMessageId ?? null,
        requestRound: record.requestRound,
        kind: record.kind,
        model: record.model,
        inputTokens: record.inputTokens ?? 0,
        outputTokens: record.outputTokens ?? 0,
        cacheCreationTokens: record.cacheCreationTokens ?? 0,
        cacheReadTokens: record.cacheReadTokens ?? 0,
        timestamp: record.timestamp ?? Date.now()
      })
  }

  appendToolUsageRecord(record: ToolUsageRecordInput): void {
    this.db
      .prepare(
        `
        INSERT INTO tool_usage_records (
          id,
          toolCallId,
          sessionId,
          assistantMessageId,
          requestRound,
          toolName,
          callType,
          status,
          durationMs,
          argsSummary,
          outputSummary,
          roundInputTokens,
          roundOutputTokens,
          roundCacheCreationTokens,
          roundCacheReadTokens,
          roundToolCallCount,
          timestamp
        )
        VALUES (
          @id,
          @toolCallId,
          @sessionId,
          @assistantMessageId,
          @requestRound,
          @toolName,
          @callType,
          @status,
          @durationMs,
          @argsSummary,
          @outputSummary,
          @roundInputTokens,
          @roundOutputTokens,
          @roundCacheCreationTokens,
          @roundCacheReadTokens,
          @roundToolCallCount,
          @timestamp
        )
        ON CONFLICT(toolCallId) DO UPDATE SET
          sessionId = excluded.sessionId,
          assistantMessageId = excluded.assistantMessageId,
          requestRound = excluded.requestRound,
          toolName = excluded.toolName,
          callType = excluded.callType,
          status = excluded.status,
          durationMs = excluded.durationMs,
          argsSummary = excluded.argsSummary,
          outputSummary = excluded.outputSummary,
          roundInputTokens = excluded.roundInputTokens,
          roundOutputTokens = excluded.roundOutputTokens,
          roundCacheCreationTokens = excluded.roundCacheCreationTokens,
          roundCacheReadTokens = excluded.roundCacheReadTokens,
          roundToolCallCount = excluded.roundToolCallCount,
          timestamp = excluded.timestamp
        `
      )
      .run({
        id: randomUUID(),
        toolCallId: record.toolCallId,
        sessionId: record.sessionId ?? null,
        assistantMessageId: record.assistantMessageId ?? null,
        requestRound: record.requestRound,
        toolName: record.toolName,
        callType: record.callType,
        status: record.status,
        durationMs: record.durationMs,
        argsSummary: record.argsSummary ?? '',
        outputSummary: record.outputSummary ?? '',
        roundInputTokens: record.roundInputTokens ?? 0,
        roundOutputTokens: record.roundOutputTokens ?? 0,
        roundCacheCreationTokens: record.roundCacheCreationTokens ?? 0,
        roundCacheReadTokens: record.roundCacheReadTokens ?? 0,
        roundToolCallCount: Math.max(1, record.roundToolCallCount ?? 1),
        timestamp: record.timestamp ?? Date.now()
      })
  }

  appendSkillUsageRecord(record: SkillUsageRecordInput): void {
    this.db
      .prepare(
        `
        INSERT INTO skill_usage_records (
          id,
          sessionId,
          assistantMessageId,
          requestRound,
          toolCallId,
          skillId,
          skillName,
          skillFilePath,
          timestamp
        )
        VALUES (
          @id,
          @sessionId,
          @assistantMessageId,
          @requestRound,
          @toolCallId,
          @skillId,
          @skillName,
          @skillFilePath,
          @timestamp
        )
        ON CONFLICT(assistantMessageId, skillId) DO UPDATE SET
          sessionId = excluded.sessionId,
          requestRound = excluded.requestRound,
          toolCallId = excluded.toolCallId,
          skillName = excluded.skillName,
          skillFilePath = excluded.skillFilePath,
          timestamp = excluded.timestamp
        `
      )
      .run({
        id: randomUUID(),
        sessionId: record.sessionId ?? null,
        assistantMessageId: record.assistantMessageId,
        requestRound: record.requestRound,
        toolCallId: record.toolCallId,
        skillId: record.skillId,
        skillName: record.skillName,
        skillFilePath: record.skillFilePath,
        timestamp: record.timestamp ?? Date.now()
      })
  }

  async listSkillUsageRecords(limit = 100): Promise<SkillUsageRecord[]> {
    return this.db
      .prepare(
        `
        SELECT
          records.id as id,
          records.sessionId as sessionId,
          sessions.title as sessionTitle,
          records.assistantMessageId as assistantMessageId,
          records.requestRound as requestRound,
          records.toolCallId as toolCallId,
          records.skillId as skillId,
          records.skillName as skillName,
          records.skillFilePath as skillFilePath,
          records.timestamp as timestamp
        FROM skill_usage_records records
        LEFT JOIN chat_sessions sessions ON sessions.id = records.sessionId
        ORDER BY records.timestamp DESC
        LIMIT ?
        `
      )
      .all(limit) as SkillUsageRecord[]
  }

  async getUsageOverview(now = Date.now()): Promise<UsageOverview> {
    const startOfDay = new Date(now)
    startOfDay.setHours(0, 0, 0, 0)
    const dayStart = startOfDay.getTime()

    const sessionCounts = this.db
      .prepare(
        `
        SELECT COUNT(*) as totalSessions, COALESCE(SUM(messageCount), 0) as totalMessages
        FROM chat_sessions
        `
      )
      .get() as { totalSessions: number; totalMessages: number }

    const todayUsage = this.db
      .prepare(
        `
        SELECT
          COALESCE(SUM(inputTokens), 0) as todayInputTokens,
          COALESCE(SUM(outputTokens), 0) as todayOutputTokens,
          COALESCE(SUM(cacheCreationTokens), 0) as todayCacheCreationTokens,
          COALESCE(SUM(cacheReadTokens), 0) as todayCacheReadTokens
        FROM chat_usage_records
        WHERE timestamp >= ?
        `
      )
      .get(dayStart) as {
      todayInputTokens: number
      todayOutputTokens: number
      todayCacheCreationTokens: number
      todayCacheReadTokens: number
    }

    const todayTokenUsage =
      todayUsage.todayInputTokens +
      todayUsage.todayOutputTokens +
      todayUsage.todayCacheCreationTokens +
      todayUsage.todayCacheReadTokens

    return {
      todayTokenUsage,
      todayInputTokens: todayUsage.todayInputTokens,
      todayOutputTokens: todayUsage.todayOutputTokens,
      todayCacheCreationTokens: todayUsage.todayCacheCreationTokens,
      todayCacheReadTokens: todayUsage.todayCacheReadTokens,
      remainingTokens: null,
      totalSessions: sessionCounts.totalSessions,
      totalMessages: sessionCounts.totalMessages
    }
  }

  async listUsageRecords(limit = 100): Promise<UsageRecord[]> {
    const rows = this.db
      .prepare(
        `
        SELECT
          records.id as id,
          records.sessionId as sessionId,
          sessions.title as title,
          records.assistantMessageId as assistantMessageId,
          records.requestRound as requestRound,
          records.kind as kind,
          records.model as model,
          records.inputTokens as inputTokens,
          records.outputTokens as outputTokens,
          records.cacheCreationTokens as cacheCreationTokens,
          records.cacheReadTokens as cacheReadTokens,
          records.timestamp as timestamp
        FROM chat_usage_records records
        LEFT JOIN chat_sessions sessions ON sessions.id = records.sessionId
        ORDER BY records.timestamp DESC
        LIMIT ?
        `
      )
      .all(limit) as UsageRow[]

    return rows.map(rowToUsageRecord)
  }

  async listToolCallRecords(limit = 100): Promise<ToolCallUsageRecord[]> {
    const rows = this.db
      .prepare(
        `
        SELECT events.payload as payload, sessions.title as sessionTitle
        FROM chat_events events
        LEFT JOIN chat_sessions sessions ON sessions.id = events.sessionId
        WHERE events.type IN ('tool.called', 'tool.completed')
        ORDER BY events.timestamp DESC, events.id DESC
        LIMIT ?
        `
      )
      .all(limit) as Array<{ payload: string; sessionTitle: string | null }>

    return rows
      .map((row) => {
        const payload = JSON.parse(row.payload) as ToolEventPayload
        const toolName = payload.toolName ?? ''
        const callType = toolName.toLowerCase().includes('mcp') ? 'mcp' : 'tool'

        if (payload.type === 'tool.called') {
          return {
            eventId: payload.eventId,
            sessionId: payload.sessionId,
            sessionTitle: row.sessionTitle,
            timestamp: payload.timestamp,
            toolName,
            callType,
            phase: 'called',
            status: 'running',
            durationMs: null,
            argsSummary: payload.argsSummary,
            outputSummary: ''
          } satisfies ToolCallUsageRecord
        }

        return {
          eventId: payload.eventId,
          sessionId: payload.sessionId,
          sessionTitle: row.sessionTitle,
          timestamp: payload.timestamp,
          toolName,
          callType,
          phase: 'completed',
          status: payload.isError ? 'error' : 'success',
          durationMs: payload.durationMs,
          argsSummary: '',
          outputSummary: payload.outputSummary
        } satisfies ToolCallUsageRecord
      })
      .filter(Boolean)
  }

  getToolUseCountsSync(): Map<string, number> {
    const rows = this.db
      .prepare(
        `
        SELECT toolName, COUNT(*) as useCount
        FROM tool_usage_records
        GROUP BY toolName
        `
      )
      .all() as Array<{ toolName: string; useCount: number }>

    return new Map(rows.map((row) => [row.toolName, row.useCount]))
  }

  async listToolStats(limit = 100): Promise<ToolStatsRecord[]> {
    const rows = this.db
      .prepare(
        `
        SELECT
          toolName as toolName,
          callType as callType,
          COUNT(*) as useCount,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successCount,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errorCount,
          COALESCE(SUM(durationMs), 0) as totalDurationMs,
          COALESCE(AVG(durationMs), 0) as averageDurationMs,
          COALESCE(SUM(CASE WHEN roundToolCallCount > 0 THEN (roundInputTokens * 1.0) / roundToolCallCount ELSE 0 END), 0) as totalInputTokens,
          COALESCE(SUM(CASE WHEN roundToolCallCount > 0 THEN (roundOutputTokens * 1.0) / roundToolCallCount ELSE 0 END), 0) as totalOutputTokens,
          COALESCE(SUM(CASE WHEN roundToolCallCount > 0 THEN (roundCacheCreationTokens * 1.0) / roundToolCallCount ELSE 0 END), 0) as totalCacheCreationTokens,
          COALESCE(SUM(CASE WHEN roundToolCallCount > 0 THEN (roundCacheReadTokens * 1.0) / roundToolCallCount ELSE 0 END), 0) as totalCacheReadTokens,
          MAX(timestamp) as lastUsedAt
        FROM tool_usage_records
        GROUP BY toolName, callType
        `
      )
      .all() as ToolStatsRow[]

    return rows
      .map(rowToToolStatsRecord)
      .sort((left, right) =>
        compareToolPriorityMetrics(
          {
            name: left.toolName,
            basePriority: left.basePriority,
            useCount: left.useCount
          },
          {
            name: right.toolName,
            basePriority: right.basePriority,
            useCount: right.useCount
          }
        )
      )
      .slice(0, limit)
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
