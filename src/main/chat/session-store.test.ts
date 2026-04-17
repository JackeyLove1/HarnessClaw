import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatEvent, SessionMeta } from '@shared/models'
import {
  ChatSessionStore,
  DEFAULT_SESSION_TITLE,
  fallbackTitleFromUserText,
  selectRecentSessions,
  sortSessionsByUpdatedAt
} from './session-store'

const cleanupDatabases: Database.Database[] = []

afterEach(async () => {
  for (const database of cleanupDatabases.splice(0)) {
    database.close()
  }
})

describe('ChatSessionStore', () => {
  const createStore = (): ChatSessionStore => {
    const database = new Database(':memory:')
    cleanupDatabases.push(database)
    return new ChatSessionStore({ database })
  }

  it('creates a session and replays the persisted snapshot from sqlite', async () => {
    const store = createStore()

    const meta = await store.createSession('session-under-test-0000-0000-000000000000')
    const snapshot = await store.openSession(meta.id)

    expect(snapshot.meta.id).toBe('session-under-test-0000-0000-000000000000')
    expect(snapshot.meta.title).toBe(DEFAULT_SESSION_TITLE)
    expect(snapshot.events).toHaveLength(1)
    expect(snapshot.events[0]?.type).toBe('session.created')
  })

  it('appends and replays transcript events from sqlite rows', async () => {
    const store = createStore()
    const meta = await store.createSession()

    const userEvent: ChatEvent = {
      type: 'user.message',
      eventId: 'user-event',
      sessionId: meta.id,
      timestamp: Date.now(),
      messageId: 'user-1',
      text: 'hello'
    }

    await store.appendEvent(meta.id, userEvent)
    const snapshot = await store.openSession(meta.id)

    expect(snapshot.events.some((event) => event.type === 'user.message')).toBe(true)
  })

  it('searches sessions by message text with full-text index', async () => {
    const store = createStore()
    const economicSession = await store.createSession('session-economic')
    const otherSession = await store.createSession('session-other')

    await store.appendEvent(economicSession.id, {
      type: 'user.message',
      eventId: 'user-economic-1',
      sessionId: economicSession.id,
      timestamp: Date.now(),
      messageId: 'economic-user',
      text: '请给我最新的通胀和CPI数据'
    })

    await store.appendEvent(otherSession.id, {
      type: 'user.message',
      eventId: 'user-other-1',
      sessionId: otherSession.id,
      timestamp: Date.now(),
      messageId: 'other-user',
      text: '帮我起草一封邮件'
    })

    const results = await store.searchSessions('通胀')
    expect(results.map((session) => session.id)).toEqual([economicSession.id])
  })

  it('returns all sessions when search query is empty', async () => {
    const store = createStore()
    await store.createSession('session-a')
    await store.createSession('session-b')

    const results = await store.searchSessions(' ')
    expect(results).toHaveLength(2)
  })

  it('persists normalized tool usage and aggregates tool stats', async () => {
    const store = createStore()
    const session = await store.createSession('session-tools')

    store.appendToolUsageRecord({
      toolCallId: 'tool-call-1',
      sessionId: session.id,
      assistantMessageId: 'assistant-1',
      requestRound: 1,
      toolName: 'read_file',
      callType: 'tool',
      status: 'success',
      durationMs: 25,
      argsSummary: '{"path":"README.md"}',
      outputSummary: 'ok',
      roundInputTokens: 120,
      roundOutputTokens: 30,
      roundCacheCreationTokens: 10,
      roundCacheReadTokens: 0,
      roundToolCallCount: 2,
      timestamp: 1_000
    })

    store.appendToolUsageRecord({
      toolCallId: 'tool-call-2',
      sessionId: session.id,
      assistantMessageId: 'assistant-1',
      requestRound: 1,
      toolName: 'read_file',
      callType: 'tool',
      status: 'error',
      durationMs: 35,
      argsSummary: '{"path":"missing.md"}',
      outputSummary: 'missing',
      roundInputTokens: 120,
      roundOutputTokens: 30,
      roundCacheCreationTokens: 10,
      roundCacheReadTokens: 0,
      roundToolCallCount: 2,
      timestamp: 1_100
    })

    const stats = await store.listToolStats(10)
    const readFileStats = stats.find((record) => record.toolName === 'read_file')

    expect(readFileStats).toBeDefined()
    expect(readFileStats?.useCount).toBe(2)
    expect(readFileStats?.successCount).toBe(1)
    expect(readFileStats?.errorCount).toBe(1)
    expect(readFileStats?.effectivePriority).toBe(102)
    expect(readFileStats?.totalTokens).toBe(160)
  })

  it('returns tool use counts for runtime priority sorting', async () => {
    const store = createStore()
    const session = await store.createSession('session-priority')

    store.appendToolUsageRecord({
      toolCallId: 'tool-call-a',
      sessionId: session.id,
      requestRound: 1,
      toolName: 'todo',
      callType: 'tool',
      status: 'success',
      durationMs: 5
    })

    store.appendToolUsageRecord({
      toolCallId: 'tool-call-b',
      sessionId: session.id,
      requestRound: 1,
      toolName: 'todo',
      callType: 'tool',
      status: 'error',
      durationMs: 6
    })

    expect(store.getToolUseCountsSync().get('todo')).toBe(2)
  })

  it('deduplicates skill usage per assistant message and skill id', async () => {
    const store = createStore()
    const session = await store.createSession('session-skills')

    store.appendSkillUsageRecord({
      sessionId: session.id,
      assistantMessageId: 'assistant-1',
      requestRound: 1,
      toolCallId: 'tool-call-1',
      skillId: 'powerpoint',
      skillName: 'powerpoint',
      skillFilePath: 'C:/skills/powerpoint/SKILL.md',
      timestamp: 1_000
    })

    store.appendSkillUsageRecord({
      sessionId: session.id,
      assistantMessageId: 'assistant-1',
      requestRound: 2,
      toolCallId: 'tool-call-2',
      skillId: 'powerpoint',
      skillName: 'powerpoint',
      skillFilePath: 'C:/skills/powerpoint/SKILL.md',
      timestamp: 1_200
    })

    const records = await store.listSkillUsageRecords()

    expect(records).toHaveLength(1)
    expect(records[0]?.sessionId).toBe(session.id)
    expect(records[0]?.assistantMessageId).toBe('assistant-1')
    expect(records[0]?.requestRound).toBe(2)
    expect(records[0]?.toolCallId).toBe('tool-call-2')
    expect(records[0]?.skillId).toBe('powerpoint')
  })

  it('replays structured tool fault fields from persisted tool events', async () => {
    const store = createStore()
    const session = await store.createSession('session-tool-events')

    await store.appendEvent(session.id, {
      type: 'tool.completed',
      eventId: 'tool-completed-1',
      sessionId: session.id,
      timestamp: 2_000,
      assistantMessageId: 'assistant-1',
      groupId: 'group-1',
      requestRound: 1,
      toolCallId: 'tool-call-1',
      toolName: 'read_file',
      outputSummary: 'read_file failed [TOOL_TIMEOUT]',
      durationMs: 120,
      isError: true,
      roundInputTokens: 10,
      roundOutputTokens: 4,
      roundCacheCreationTokens: 0,
      roundCacheReadTokens: 0,
      roundToolCallCount: 1,
      errorCode: 'TOOL_TIMEOUT',
      errorType: 'transient',
      failureStage: 'timeout',
      validationStatus: 'skipped',
      attemptCount: 3,
      retryCount: 2,
      selfHealCount: 0,
      fallbackUsed: false
    })

    const records = await store.listToolCallRecords(10)

    expect(records).toHaveLength(1)
    expect(records[0]?.errorCode).toBe('TOOL_TIMEOUT')
    expect(records[0]?.failureStage).toBe('timeout')
    expect(records[0]?.attemptCount).toBe(3)
    expect(records[0]?.retryCount).toBe(2)
  })

  it('sorts sessions and keeps only the latest ten for the sidebar selector', () => {
    const sessions = Array.from({ length: 14 }, (_, index) => ({
      id: String(index),
      title: `Session ${index}`,
      createdAt: index,
      updatedAt: index,
      messageCount: index,
      status: 'idle'
    })) as SessionMeta[]

    const sorted = sortSessionsByUpdatedAt(sessions)
    const recent = selectRecentSessions(sessions)

    expect(sorted[0]?.updatedAt).toBe(13)
    expect(recent).toHaveLength(10)
    expect(recent[0]?.updatedAt).toBe(13)
    expect(recent[recent.length - 1]?.updatedAt).toBe(4)
  })

  it('falls back to truncated user text or a timestamp-based title', () => {
    expect(fallbackTitleFromUserText('   A very focused chat title   ')).toBe(
      'A very focused chat title'
    )
    expect(fallbackTitleFromUserText('')).toMatch(/^Chat /)
  })
})
