import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { ChatEvent, SessionMeta, SessionSnapshot } from '@shared/models'
import type {
  SendMessageInput,
  SkillUsageRecord,
  ToolCallUsageRecord,
  ToolStatsRecord,
  UsageOverview,
  UsageRecord
} from '@shared/types'
import {
  ChatSessionStore,
  DEFAULT_SESSION_TITLE,
  clampSessionTitle,
  fallbackTitleFromUserText,
  type SessionMemoryRecord
} from './session-store'
import {
  createSessionMemoryCompactor,
  selectSummarizableEvents,
  type SessionMemoryCompactor
} from '../agent/compaction'
import { validateRuntimeConfig } from '../agent/config'
import { createChatRuntime } from '../agent'
import { removeSessionAttachmentDir, savePendingImageAttachments } from './image-attachments'

type ActiveRun = {
  abortController: AbortController
}

type PreparedSessionMemory = {
  summary: string | null
  updatedAt: number
  isReady: boolean
}

type ChatRuntimeLike = {
  runTurn: (args: {
    sessionId: string
    userText: string
    hasUserContent?: boolean
    sessionMemory?: string | null
    history: ChatEvent[]
    signal: AbortSignal
  }) => AsyncIterable<ChatEvent>
  generateTitle: (args: {
    sessionId: string
    userText: string
    assistantText: string
  }) => Promise<string>
}

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Chat runtime failed unexpectedly.'
}

const createEventId = (type: ChatEvent['type']): string => `${type}_${randomUUID()}`

const getLatestTimestamp = (events: ChatEvent[]): number =>
  events.reduce((latest, event) => Math.max(latest, event.timestamp), 0)

export class ChatSupervisor {
  private readonly windows = new Set<BrowserWindow>()

  private readonly activeRuns = new Map<string, ActiveRun>()

  private readonly store: ChatSessionStore

  private readonly runtime: ChatRuntimeLike

  private readonly sessionMemoryCompactor: SessionMemoryCompactor

  constructor(
    store = new ChatSessionStore(),
    options: {
      runtime?: ChatRuntimeLike
      sessionMemoryCompactor?: SessionMemoryCompactor
    } = {}
  ) {
    this.store = store
    this.runtime = options.runtime ?? createChatRuntime()
    this.sessionMemoryCompactor = options.sessionMemoryCompactor ?? createSessionMemoryCompactor()
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

  async getUsageOverview(): Promise<UsageOverview> {
    return this.store.getUsageOverview()
  }

  async listUsageRecords(limit?: number): Promise<UsageRecord[]> {
    return this.store.listUsageRecords(limit)
  }

  async listToolCallRecords(limit?: number): Promise<ToolCallUsageRecord[]> {
    return this.store.listToolCallRecords(limit)
  }

  async listToolStats(limit?: number): Promise<ToolStatsRecord[]> {
    return this.store.listToolStats(limit)
  }

  async listSkillUsageRecords(limit?: number): Promise<SkillUsageRecord[]> {
    return this.store.listSkillUsageRecords(limit)
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
    await removeSessionAttachmentDir(sessionId)
  }

  async cancelRun(sessionId: string): Promise<void> {
    const activeRun = this.activeRuns.get(sessionId)
    activeRun?.abortController.abort()
  }

  async publishExternalEvent(
    sessionId: string,
    event: ChatEvent,
    metaUpdate?: Partial<SessionMeta>
  ): Promise<void> {
    const current = await this.store.readMeta(sessionId)
    await this.store.appendEvent(sessionId, event)
    await this.store.updateMeta(sessionId, {
      ...current,
      updatedAt: event.timestamp,
      ...metaUpdate
    })
    this.broadcast(event)
  }

  async sendMessage(sessionId: string, input: SendMessageInput): Promise<void> {
    const trimmed = input.text.trim()
    const attachments = input.attachments ?? []

    if (!trimmed && attachments.length === 0) {
      return
    }

    const validation = validateRuntimeConfig()
    if (!validation.ok) {
      await this.persistError(sessionId, validation.message)
      return
    }

    if (this.activeRuns.has(sessionId)) {
      throw new Error(
        'This chat is already responding. Cancel the current run before sending a new message.'
      )
    }

    let abortController: AbortController | null = null

    try {
      abortController = new AbortController()
      this.activeRuns.set(sessionId, { abortController })

      const snapshot = await this.store.openSession(sessionId)
      const sessionMemory = await this.prepareSessionMemory(
        sessionId,
        snapshot.events,
        abortController.signal
      )
      const persistedAttachments = await savePendingImageAttachments(sessionId, attachments)
      const userEvent: ChatEvent = {
        type: 'user.message',
        eventId: createEventId('user.message'),
        sessionId,
        timestamp: Date.now(),
        messageId: `user_${randomUUID()}`,
        text: trimmed,
        attachments: persistedAttachments
      }

      await this.store.appendEvent(sessionId, userEvent)
      await this.store.updateMeta(sessionId, {
        updatedAt: userEvent.timestamp,
        status: 'running',
        messageCount: snapshot.meta.messageCount + 1
      })
      this.broadcast(userEvent)

      let assistantText = ''
      let assistantCompletedEvent: Extract<ChatEvent, { type: 'assistant.completed' }> | null = null
      let shouldGenerateTitle = false
      const turnEvents: ChatEvent[] = []
      const toolArgsByCallId = new Map<
        string,
        { assistantMessageId: string; requestRound: number; toolName: string; argsSummary: string }
      >()

      for await (const event of this.runtime.runTurn({
        sessionId,
        userText: trimmed,
        hasUserContent: Boolean(trimmed) || persistedAttachments.length > 0,
        sessionMemory: sessionMemory.summary,
        history: sessionMemory.summary ? [userEvent] : [...snapshot.events, userEvent],
        signal: abortController.signal
      })) {
        assistantText = event.type === 'assistant.completed' ? event.text : assistantText

        await this.store.appendEvent(sessionId, event)
        turnEvents.push(event)

        if (event.type === 'tool.called') {
          toolArgsByCallId.set(event.toolCallId, {
            assistantMessageId: event.assistantMessageId,
            requestRound: event.requestRound,
            toolName: event.toolName,
            argsSummary: event.argsSummary
          })
        }

        if (event.type === 'tool.completed') {
          const toolMeta = toolArgsByCallId.get(event.toolCallId)
          this.store.appendToolUsageRecord({
            toolCallId: event.toolCallId,
            sessionId,
            assistantMessageId: event.assistantMessageId ?? toolMeta?.assistantMessageId ?? null,
            requestRound: event.requestRound ?? toolMeta?.requestRound ?? 0,
            toolName: event.toolName ?? toolMeta?.toolName ?? '',
            callType: event.toolName.toLowerCase().includes('mcp') ? 'mcp' : 'tool',
            status: event.isError ? 'error' : 'success',
            durationMs: event.durationMs,
            argsSummary: toolMeta?.argsSummary ?? '',
            outputSummary: event.outputSummary,
            roundInputTokens: event.roundInputTokens,
            roundOutputTokens: event.roundOutputTokens,
            roundCacheCreationTokens: event.roundCacheCreationTokens,
            roundCacheReadTokens: event.roundCacheReadTokens,
            roundToolCallCount: event.roundToolCallCount,
            errorCode: event.errorCode,
            errorType: event.errorType,
            failureStage: event.failureStage,
            validationStatus: event.validationStatus,
            attemptCount: event.attemptCount,
            retryCount: event.retryCount,
            selfHealCount: event.selfHealCount,
            fallbackUsed: event.fallbackUsed,
            fallbackStrategy: event.fallbackStrategy,
            timestamp: event.timestamp
          })
          toolArgsByCallId.delete(event.toolCallId)
        }

        if (event.type === 'assistant.completed' && event.apiUsages?.length) {
          for (const usage of event.apiUsages) {
            await this.store.appendUsageRecord({
              sessionId,
              assistantMessageId: event.messageId,
              requestRound: usage.requestRound,
              kind: 'chat_turn',
              model: usage.model,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheCreationTokens: usage.cacheCreationTokens,
              cacheReadTokens: usage.cacheReadTokens,
              timestamp: usage.timestamp
            })
          }
        }

        if (event.type === 'assistant.completed') {
          assistantCompletedEvent = event
          const updatedMeta = await this.store.updateMeta(sessionId, (current) => ({
            ...current,
            updatedAt: event.timestamp,
            status: 'idle',
            messageCount: current.messageCount + 1
          }))
          shouldGenerateTitle =
            updatedMeta.title === DEFAULT_SESSION_TITLE &&
            updatedMeta.messageCount <= 2 &&
            Boolean(assistantText)
        }

        this.broadcast(event)
      }

      if (assistantCompletedEvent) {
        await this.persistSessionMemoryAfterTurn({
          sessionId,
          preparedMemory: sessionMemory,
          priorEvents: snapshot.events,
          currentTurnEvents: [userEvent, ...turnEvents],
          signal: abortController.signal
        })
      }

      if (shouldGenerateTitle) {
        await this.generateAndPersistTitle(sessionId, assistantText)
      }
    } catch (error) {
      if (abortController?.signal.aborted) {
        await this.persistCancelled(sessionId)
      } else {
        await this.persistError(sessionId, toErrorMessage(error))
      }
    } finally {
      if (abortController) {
        this.activeRuns.delete(sessionId)
      }
    }
  }

  private async generateAndPersistTitle(sessionId: string, assistantText: string): Promise<void> {
    const snapshot = await this.store.openSession(sessionId)

    if (snapshot.meta.title !== DEFAULT_SESSION_TITLE) {
      return
    }

    const firstUserMessage = snapshot.events.find(
      (event): event is Extract<ChatEvent, { type: 'user.message' }> => {
        return event.type === 'user.message'
      }
    )

    const fallback = fallbackTitleFromUserText(
      firstUserMessage?.text ?? '',
      snapshot.meta.createdAt
    )
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

  private async prepareSessionMemory(
    sessionId: string,
    events: ChatEvent[],
    signal?: AbortSignal
  ): Promise<PreparedSessionMemory> {
    const existing = await this.store.getSessionMemory(sessionId)
    if (!existing) {
      const bootstrapEvents = selectSummarizableEvents(events)
      if (bootstrapEvents.length === 0) {
        return { summary: null, updatedAt: 0, isReady: true }
      }

      try {
        const summary = await this.sessionMemoryCompactor.bootstrapSessionMemory({
          sessionId,
          history: bootstrapEvents,
          signal
        })
        if (!summary.trim()) {
          return { summary: null, updatedAt: 0, isReady: false }
        }

        const updatedAt = getLatestTimestamp(bootstrapEvents)
        await this.store.upsertSessionMemory(sessionId, summary, updatedAt)
        return { summary, updatedAt, isReady: true }
      } catch (error) {
        console.warn('[session-memory] failed to bootstrap memory', error)
        return { summary: null, updatedAt: 0, isReady: false }
      }
    }

    const staleEvents = selectSummarizableEvents(events, existing.updatedAt)
    if (staleEvents.length === 0) {
      return {
        summary: existing.summary,
        updatedAt: existing.updatedAt,
        isReady: true
      }
    }

    try {
      const summary = await this.sessionMemoryCompactor.extendSessionMemory({
        sessionId,
        previousSummary: existing.summary,
        historyDelta: staleEvents,
        signal
      })
      if (!summary.trim()) {
        return {
          summary: existing.summary,
          updatedAt: existing.updatedAt,
          isReady: false
        }
      }

      const updatedAt = getLatestTimestamp(staleEvents)
      await this.store.upsertSessionMemory(sessionId, summary, updatedAt)
      return { summary, updatedAt, isReady: true }
    } catch (error) {
      console.warn('[session-memory] failed to catch up memory', error)
      return {
        summary: existing.summary,
        updatedAt: existing.updatedAt,
        isReady: false
      }
    }
  }

  private async persistSessionMemoryAfterTurn({
    sessionId,
    preparedMemory,
    priorEvents,
    currentTurnEvents,
    signal
  }: {
    sessionId: string
    preparedMemory: PreparedSessionMemory
    priorEvents: ChatEvent[]
    currentTurnEvents: ChatEvent[]
    signal?: AbortSignal
  }): Promise<SessionMemoryRecord | null> {
    const turnDelta = selectSummarizableEvents(currentTurnEvents)
    if (preparedMemory.summary && preparedMemory.isReady) {
      if (turnDelta.length === 0) {
        return null
      }

      try {
        const summary = await this.sessionMemoryCompactor.extendSessionMemory({
          sessionId,
          previousSummary: preparedMemory.summary,
          historyDelta: turnDelta,
          signal
        })
        if (!summary.trim()) {
          return null
        }

        return this.store.upsertSessionMemory(sessionId, summary, getLatestTimestamp(turnDelta))
      } catch (error) {
        console.warn('[session-memory] failed to update memory after turn', error)
        return null
      }
    }

    const fullHistory = selectSummarizableEvents([...priorEvents, ...currentTurnEvents])
    if (fullHistory.length === 0) {
      return null
    }

    try {
      const summary = await this.sessionMemoryCompactor.bootstrapSessionMemory({
        sessionId,
        history: fullHistory,
        signal
      })
      if (!summary.trim()) {
        return null
      }

      return this.store.upsertSessionMemory(sessionId, summary, getLatestTimestamp(fullHistory))
    } catch (error) {
      console.warn('[session-memory] failed to rebuild memory after turn', error)
      return null
    }
  }
}
