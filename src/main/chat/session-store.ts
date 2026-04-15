import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { ChatEvent, SessionMeta, SessionSnapshot } from '@shared/models'

export const CHAT_ROOT_DIRNAME = '.deepclaw'
export const CHAT_SESSIONS_DIRNAME = 'sessions'
export const DEFAULT_SESSION_TITLE = 'New chat'

type SessionStoreOptions = {
  rootDir?: string
}

const serialize = (value: unknown): string => JSON.stringify(value, null, 2)

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

const parseJsonLines = <T>(input: string): T[] =>
  input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)

export class ChatSessionStore {
  constructor(private readonly options: SessionStoreOptions = {}) {}

  get rootDir(): string {
    return this.options.rootDir ?? path.join(homedir(), CHAT_ROOT_DIRNAME)
  }

  get sessionsDir(): string {
    return path.join(this.rootDir, CHAT_SESSIONS_DIRNAME)
  }

  private getSessionPaths(sessionId: string): { dir: string; meta: string; events: string } {
    const dir = path.join(this.sessionsDir, sessionId)

    return {
      dir,
      meta: path.join(dir, 'meta.json'),
      events: path.join(dir, 'events.jsonl')
    }
  }

  private async ensureDirectories(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true })
  }

  async createSession(sessionId = randomUUID()): Promise<SessionMeta> {
    await this.ensureDirectories()

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

    const paths = this.getSessionPaths(sessionId)
    await mkdir(paths.dir, { recursive: true })
    await writeFile(paths.meta, serialize(meta), 'utf8')
    await appendFile(paths.events, `${JSON.stringify(event)}\n`, 'utf8')

    return meta
  }

  async readMeta(sessionId: string): Promise<SessionMeta> {
    const paths = this.getSessionPaths(sessionId)
    const raw = await readFile(paths.meta, 'utf8')
    return JSON.parse(raw) as SessionMeta
  }

  async updateMeta(
    sessionId: string,
    update: Partial<SessionMeta> | ((current: SessionMeta) => SessionMeta)
  ): Promise<SessionMeta> {
    const current = await this.readMeta(sessionId)
    const next = typeof update === 'function' ? update(current) : { ...current, ...update }
    const paths = this.getSessionPaths(sessionId)
    await writeFile(paths.meta, serialize(next), 'utf8')
    return next
  }

  async appendEvent(sessionId: string, event: ChatEvent): Promise<void> {
    await this.ensureDirectories()
    const paths = this.getSessionPaths(sessionId)
    await mkdir(paths.dir, { recursive: true })
    await appendFile(paths.events, `${JSON.stringify(event)}\n`, 'utf8')
  }

  async readEvents(sessionId: string): Promise<ChatEvent[]> {
    const paths = this.getSessionPaths(sessionId)

    try {
      const raw = await readFile(paths.events, 'utf8')
      return parseJsonLines<ChatEvent>(raw)
    } catch {
      return []
    }
  }

  async openSession(sessionId: string): Promise<SessionSnapshot> {
    const [meta, events] = await Promise.all([this.readMeta(sessionId), this.readEvents(sessionId)])
    return { meta, events }
  }

  async listSessions(): Promise<SessionMeta[]> {
    await this.ensureDirectories()
    const entries = await readdir(this.sessionsDir, { withFileTypes: true })
    const metas = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          try {
            return await this.readMeta(entry.name)
          } catch {
            return null
          }
        })
    )

    return sortSessionsByUpdatedAt(metas.filter((value): value is SessionMeta => value != null))
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
    const paths = this.getSessionPaths(sessionId)
    await rm(paths.dir, { recursive: true, force: true })
  }
}
