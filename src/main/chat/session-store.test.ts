import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatEvent, SessionMeta } from '@shared/models'
import {
  ChatSessionStore,
  DEFAULT_SESSION_TITLE,
  fallbackTitleFromUserText,
  selectRecentSessions,
  sortSessionsByUpdatedAt
} from './session-store'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })))
})

describe('ChatSessionStore', () => {
  it('creates a session directory with meta.json and events.jsonl data', async () => {
    const rootDir = path.join(tmpdir(), `notemark-chat-${randomUUID()}`)
    cleanupPaths.push(rootDir)
    const store = new ChatSessionStore({ rootDir })

    const meta = await store.createSession('session-under-test-0000-0000-000000000000')
    const snapshot = await store.openSession(meta.id)

    expect(snapshot.meta.id).toBe('session-under-test-0000-0000-000000000000')
    expect(snapshot.meta.title).toBe(DEFAULT_SESSION_TITLE)
    expect(snapshot.events).toHaveLength(1)
    expect(snapshot.events[0]?.type).toBe('session.created')
  })

  it('appends and replays transcript events from events.jsonl', async () => {
    const rootDir = path.join(tmpdir(), `notemark-chat-${randomUUID()}`)
    cleanupPaths.push(rootDir)
    const store = new ChatSessionStore({ rootDir })
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
