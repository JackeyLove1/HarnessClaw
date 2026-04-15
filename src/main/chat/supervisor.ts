import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { ChatEvent, SessionMeta, SessionSnapshot } from '@shared/models'
import { ChatSessionStore, DEFAULT_SESSION_TITLE, clampSessionTitle, fallbackTitleFromUserText } from './session-store'

// @ts-ignore Runtime lives in a top-level JS module by design.
import { createChatRuntime } from '../../../agent-runtime/index.js'

type ActiveRun = {
  abortController: AbortController
}

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Chat runtime failed unexpectedly.'
}

const createEventId = (type: ChatEvent['type']): string => `${type}_${randomUUID()}`

export class ChatSupervisor {
  private readonly windows = new Set<BrowserWindow>()

  private readonly activeRuns = new Map<string, ActiveRun>()

  private readonly store: ChatSessionStore

  private readonly runtime: {
    runTurn: (args: {
      sessionId: string
      userText: string
      history: ChatEvent[]
      signal: AbortSignal
    }) => AsyncIterable<ChatEvent>
    generateTitle: (args: {
      sessionId: string
      userText: string
      assistantText: string
    }) => Promise<string>
  }

  constructor(store = new ChatSessionStore()) {
    this.store = store
    this.runtime = createChatRuntime()
  }

  attachWindow(window: BrowserWindow): void {
    this.windows.add(window)
    window.on('closed', () => {
      this.windows.delete(window)
    })
  }

  private broadcast(event: ChatEvent): void {
    for (const window of this.windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('chat:event', event)
      }
    }
  }

  async listSessions(): Promise<SessionMeta[]> {
    return this.store.listSessions()
  }

  async searchSessions(query: string): Promise<SessionMeta[]> {
    return this.store.searchSessions(query)
  }

  async createSession(): Promise<SessionMeta> {
    return this.store.createSession()
  }

  async openSession(sessionId: string): Promise<SessionSnapshot> {
    return this.store.openSession(sessionId)
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<SessionMeta> {
    const safeTitle = clampSessionTitle(title)
    if (!safeTitle) {
      throw new Error('Session title cannot be empty.')
    }

    const updated = await this.store.updateSessionTitle(sessionId, safeTitle)
    const titleEvent: ChatEvent = {
      type: 'session.title.updated',
      eventId: createEventId('session.title.updated'),
      sessionId,
      timestamp: updated.updatedAt,
      title: updated.title
    }

    await this.store.appendEvent(sessionId, titleEvent)
    this.broadcast(titleEvent)
    return updated
  }

  async deleteSession(sessionId: string): Promise<void> {
    const activeRun = this.activeRuns.get(sessionId)
    if (activeRun) {
      activeRun.abortController.abort()
      this.activeRuns.delete(sessionId)
    }

    await this.store.deleteSession(sessionId)
  }

  async cancelRun(sessionId: string): Promise<void> {
    const activeRun = this.activeRuns.get(sessionId)
    activeRun?.abortController.abort()
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) {
      return
    }

    if (this.activeRuns.has(sessionId)) {
      throw new Error('This chat is already responding. Cancel the current run before sending a new message.')
    }

    const snapshot = await this.store.openSession(sessionId)
    const userEvent: ChatEvent = {
      type: 'user.message',
      eventId: createEventId('user.message'),
      sessionId,
      timestamp: Date.now(),
      messageId: `user_${randomUUID()}`,
      text: trimmed
    }

    await this.store.appendEvent(sessionId, userEvent)
    await this.store.updateMeta(sessionId, {
      updatedAt: userEvent.timestamp,
      status: 'running',
      messageCount: snapshot.meta.messageCount + 1
    })
    this.broadcast(userEvent)

    const abortController = new AbortController()
    this.activeRuns.set(sessionId, { abortController })

    let assistantText = ''
    let shouldGenerateTitle = false

    try {
      for await (const event of this.runtime.runTurn({
        sessionId,
        userText: trimmed,
        history: [...snapshot.events, userEvent],
        signal: abortController.signal
      })) {
        assistantText = event.type === 'assistant.completed' ? event.text : assistantText

        await this.store.appendEvent(sessionId, event)

        if (event.type === 'assistant.completed') {
          const updatedMeta = await this.store.updateMeta(sessionId, (current) => ({
            ...current,
            updatedAt: event.timestamp,
            status: 'idle',
            messageCount: current.messageCount + 1
          }))
          shouldGenerateTitle =
            updatedMeta.title === DEFAULT_SESSION_TITLE && updatedMeta.messageCount <= 2 && Boolean(assistantText)
        }

        this.broadcast(event)
      }

      if (shouldGenerateTitle) {
        await this.generateAndPersistTitle(sessionId, assistantText)
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        await this.persistCancelled(sessionId)
      } else {
        await this.persistError(sessionId, toErrorMessage(error))
      }
    } finally {
      this.activeRuns.delete(sessionId)
    }
  }

  private async generateAndPersistTitle(sessionId: string, assistantText: string): Promise<void> {
    const snapshot = await this.store.openSession(sessionId)

    if (snapshot.meta.title !== DEFAULT_SESSION_TITLE) {
      return
    }

    const firstUserMessage = snapshot.events.find((event): event is Extract<ChatEvent, { type: 'user.message' }> => {
      return event.type === 'user.message'
    })

    const fallback = fallbackTitleFromUserText(firstUserMessage?.text ?? '', snapshot.meta.createdAt)
    let nextTitle = fallback

    try {
      nextTitle = await this.runtime.generateTitle({
        sessionId,
        userText: firstUserMessage?.text ?? '',
        assistantText
      })
    } catch {
      nextTitle = fallback
    }

    const safeTitle = nextTitle || fallback
    const titleEvent: ChatEvent = {
      type: 'session.title.updated',
      eventId: createEventId('session.title.updated'),
      sessionId,
      timestamp: Date.now(),
      title: safeTitle
    }

    await this.store.updateMeta(sessionId, {
      title: safeTitle,
      updatedAt: titleEvent.timestamp
    })
    await this.store.appendEvent(sessionId, titleEvent)
    this.broadcast(titleEvent)
  }

  private async persistCancelled(sessionId: string): Promise<void> {
    const event: ChatEvent = {
      type: 'session.cancelled',
      eventId: createEventId('session.cancelled'),
      sessionId,
      timestamp: Date.now()
    }

    await this.store.updateMeta(sessionId, {
      status: 'cancelled',
      updatedAt: event.timestamp
    })
    await this.store.appendEvent(sessionId, event)
    this.broadcast(event)
  }

  private async persistError(sessionId: string, message: string): Promise<void> {
    const event: ChatEvent = {
      type: 'session.error',
      eventId: createEventId('session.error'),
      sessionId,
      timestamp: Date.now(),
      message
    }

    await this.store.updateMeta(sessionId, {
      status: 'error',
      updatedAt: event.timestamp
    })
    await this.store.appendEvent(sessionId, event)
    this.broadcast(event)
  }
}
