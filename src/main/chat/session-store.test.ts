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
    expect(fallbackTitleFromUserText('   A very focused chat title   ')).toBe('A very focused chat title')
    expect(fallbackTitleFromUserText('')).toMatch(/^Chat /)
  })
})
