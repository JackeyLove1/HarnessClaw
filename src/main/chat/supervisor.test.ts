import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '@shared/models'
import type { SendMessageInput } from '@shared/types'
import { ChatSessionStore } from './session-store'

vi.mock('./image-attachments', () => ({
  removeSessionAttachmentDir: vi.fn(async () => undefined),
  savePendingImageAttachments: vi.fn(async () => [])
}))

import { ChatSupervisor } from './supervisor'

const ORIGINAL_ENV = { ...process.env }
const cleanupDatabases: Database.Database[] = []

const resetEnv = (): void => {
  for (const key of Object.keys(process.env)) {
    delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

const createStore = (): ChatSessionStore => {
  const database = new Database(':memory:')
  cleanupDatabases.push(database)
  return new ChatSessionStore({ database })
}

const buildRuntime = (
  responder: (args: {
    sessionId: string
    userText: string
    hasUserContent?: boolean
    sessionMemory?: string | null
    history: ChatEvent[]
    signal: AbortSignal
  }) => AsyncIterable<ChatEvent>
) => ({
  runTurn: vi.fn(responder),
  generateTitle: vi.fn(async () => 'Ignored Title')
})

const buildAssistantEvents = (sessionId: string): ChatEvent[] => [
  {
    type: 'assistant.started',
    eventId: 'assistant.started_test',
    sessionId,
    timestamp: 100,
    messageId: 'assistant_1'
  },
  {
    type: 'assistant.completed',
    eventId: 'assistant.completed_test',
    sessionId,
    timestamp: 110,
    messageId: 'assistant_1',
    text: 'Assistant reply',
    durationMs: 10
  }
]

const sendInput: SendMessageInput = {
  text: 'Latest user message',
  attachments: []
}

afterEach(() => {
  resetEnv()

  for (const database of cleanupDatabases.splice(0)) {
    database.close()
  }
})

describe('ChatSupervisor session memory flow', () => {
  it('bootstraps hidden session memory from prior transcript and updates it after the turn', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.NOTEMARK_MODEL_PROVIDER = 'anthropic'
    process.env.NOTEMARK_MODEL = 'claude-sonnet-4-5'

    const store = createStore()
    const session = await store.createSession('session-bootstrap')
    await store.updateMeta(session.id, {
      title: 'Existing Session',
      messageCount: 4
    })
    await store.appendEvent(session.id, {
      type: 'user.message',
      eventId: 'old-user',
      sessionId: session.id,
      timestamp: 10,
      messageId: 'old-user',
      text: 'We need to migrate the agent loop',
      attachments: []
    })
    await store.appendEvent(session.id, {
      type: 'assistant.completed',
      eventId: 'old-assistant',
      sessionId: session.id,
      timestamp: 20,
      messageId: 'old-assistant',
      text: 'I inspected the current runtime and found the entry points.',
      durationMs: 5
    })

    const runtime = buildRuntime(async function* (args) {
      expect(args.sessionMemory).toBe('bootstrapped summary')
      expect(args.history).toHaveLength(1)
      yield* buildAssistantEvents(args.sessionId)
    })
    const compactor = {
      bootstrapSessionMemory: vi.fn(async () => 'bootstrapped summary'),
      extendSessionMemory: vi.fn(async () => 'updated summary')
    }

    const supervisor = new ChatSupervisor(store, {
      runtime,
      sessionMemoryCompactor: compactor
    })

    await supervisor.sendMessage(session.id, sendInput)

    const memory = await store.getSessionMemory(session.id)
    expect(compactor.bootstrapSessionMemory).toHaveBeenCalledTimes(1)
    expect(compactor.extendSessionMemory).toHaveBeenCalledTimes(1)
    expect(memory?.summary).toBe('updated summary')
  })

  it('uses existing session memory and keeps the prompt to latest user message only', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.NOTEMARK_MODEL_PROVIDER = 'anthropic'
    process.env.NOTEMARK_MODEL = 'claude-sonnet-4-5'

    const store = createStore()
    const session = await store.createSession('session-existing-memory')
    await store.updateMeta(session.id, {
      title: 'Existing Session',
      messageCount: 6
    })
    await store.upsertSessionMemory(session.id, 'existing summary', 10_000)

    const runtime = buildRuntime(async function* (args) {
      expect(args.sessionMemory).toBe('existing summary')
      expect(args.history).toHaveLength(1)
      yield* buildAssistantEvents(args.sessionId)
    })
    const compactor = {
      bootstrapSessionMemory: vi.fn(async () => 'should not be called'),
      extendSessionMemory: vi.fn(async () => 'refreshed summary')
    }

    const supervisor = new ChatSupervisor(store, {
      runtime,
      sessionMemoryCompactor: compactor
    })

    await supervisor.sendMessage(session.id, sendInput)

    const memory = await store.getSessionMemory(session.id)
    expect(compactor.bootstrapSessionMemory).not.toHaveBeenCalled()
    expect(compactor.extendSessionMemory).toHaveBeenCalledTimes(1)
    expect(memory?.summary).toBe('refreshed summary')
  })

  it('falls back to full transcript for the run when initial bootstrap fails, then rebuilds memory after success', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.NOTEMARK_MODEL_PROVIDER = 'anthropic'
    process.env.NOTEMARK_MODEL = 'claude-sonnet-4-5'

    const store = createStore()
    const session = await store.createSession('session-fallback')
    await store.updateMeta(session.id, {
      title: 'Existing Session',
      messageCount: 4
    })
    await store.appendEvent(session.id, {
      type: 'user.message',
      eventId: 'seed-user',
      sessionId: session.id,
      timestamp: 10,
      messageId: 'seed-user',
      text: 'Remember the earlier migration discussion',
      attachments: []
    })
    await store.appendEvent(session.id, {
      type: 'assistant.completed',
      eventId: 'seed-assistant',
      sessionId: session.id,
      timestamp: 20,
      messageId: 'seed-assistant',
      text: 'I have the earlier migration context.',
      durationMs: 5
    })

    const runtime = buildRuntime(async function* (args) {
      expect(args.sessionMemory).toBeNull()
      expect(args.history.length).toBeGreaterThan(1)
      yield* buildAssistantEvents(args.sessionId)
    })
    const compactor = {
      bootstrapSessionMemory: vi
        .fn()
        .mockRejectedValueOnce(new Error('bootstrap failed'))
        .mockResolvedValueOnce('rebuilt summary'),
      extendSessionMemory: vi.fn(async () => 'unused')
    }

    const supervisor = new ChatSupervisor(store, {
      runtime,
      sessionMemoryCompactor: compactor
    })

    await supervisor.sendMessage(session.id, sendInput)

    const memory = await store.getSessionMemory(session.id)
    expect(compactor.bootstrapSessionMemory).toHaveBeenCalledTimes(2)
    expect(memory?.summary).toBe('rebuilt summary')
  })
})
