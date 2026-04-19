import Database from 'better-sqlite3'
import { unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '@shared/models'
import { ChatSessionStore } from '../chat/session-store'
import type { Tool } from './tools'

const messagesCreateMock = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  class AnthropicMock {
    messages = {
      create: messagesCreateMock
    }
  }

  return {
    default: AnthropicMock
  }
})

import { AnthropicChatRuntime } from './agent-loop'

const ORIGINAL_ENV = { ...process.env }
const cleanupDatabases: Database.Database[] = []

const resetEnv = (): void => {
  for (const key of Object.keys(process.env)) {
    delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

const toStream = (events: unknown[]): AsyncIterable<unknown> => {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event
      }
    }
  }
}

const createStore = (): ChatSessionStore => {
  const database = new Database(':memory:')
  cleanupDatabases.push(database)
  return new ChatSessionStore({ database })
}

afterEach(() => {
  resetEnv()
  messagesCreateMock.mockReset()

  for (const database of cleanupDatabases.splice(0)) {
    database.close()
  }
})

describe('AnthropicChatRuntime', () => {
  it('maps streaming tool-use rounds to chat events', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.NOTEMARK_MODEL_PROVIDER = 'anthropic'
    process.env.NOTEMARK_MODEL = 'claude-sonnet-4-5'

    let streamRound = 0
    messagesCreateMock.mockImplementation(async (params: { stream?: boolean }) => {
      if (!params.stream) {
        return {
          content: [{ type: 'text', text: 'pong' }]
        }
      }

      streamRound += 1
      if (streamRound === 1) {
        return toStream([
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' }
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Checking ' }
          },
          {
            type: 'content_block_start',
            index: 1,
            content_block: {
              type: 'tool_use',
              id: 'tool_1',
              name: 'get_time',
              input: {}
            }
          }
        ])
      }

      return toStream([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' }
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'done' }
        }
      ])
    })

    const runtime = new AnthropicChatRuntime()
    const history: ChatEvent[] = [
      {
        type: 'user.message',
        eventId: 'u_1',
        sessionId: 's_1',
        timestamp: 1,
        messageId: 'u_1',
        text: 'hi'
      }
    ]

    const events: ChatEvent[] = []
    for await (const event of runtime.runTurn({
      sessionId: 's_1',
      userText: 'hi',
      history
    })) {
      events.push(event)
    }

    expect(events.map((event) => event.type)).toEqual([
      'assistant.started',
      'assistant.delta',
      'tool.group.started',
      'tool.called',
      'tool.completed',
      'assistant.delta',
      'assistant.completed'
    ])

    const completed = events.find(
      (event): event is Extract<ChatEvent, { type: 'assistant.completed' }> => {
        return event.type === 'assistant.completed'
      }
    )
    const toolCompleted = events.find(
      (event): event is Extract<ChatEvent, { type: 'tool.completed' }> => {
        return event.type === 'tool.completed'
      }
    )

    expect(completed?.text).toBe('Checking done')
    expect(toolCompleted?.requestRound).toBe(1)
    expect(toolCompleted?.roundToolCallCount).toBe(1)
  })

  it('includes installed skills in the system prompt and records one usage row per skill per turn', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.NOTEMARK_MODEL_PROVIDER = 'anthropic'
    process.env.NOTEMARK_MODEL = 'claude-sonnet-4-5'

    const store = createStore()
    await store.createSession('s_skill')
    const skillDir = path.resolve('C:/Users/test/.deepclaw/skills/powerpoint')
    const skillFilePath = path.resolve(`${skillDir}/SKILL.md`)
    const readSkillTool: Tool = {
      name: 'read_file',
      label: 'Read file',
      description: 'Read a text file',
      inputSchema: { type: 'object' },
      execute: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              path: skillFilePath,
              content: '1|---\n2|name: powerpoint',
              truncated: false
            })
          }
        ],
        details: {
          summary: JSON.stringify({
            path: skillFilePath,
            content: '1|---\n2|name: powerpoint',
            truncated: false
          })
        }
      })
    }

    let streamRound = 0
    messagesCreateMock.mockImplementation(async (params: { stream?: boolean; system?: string }) => {
      if (!params.stream) {
        return {
          content: [{ type: 'text', text: 'pong' }]
        }
      }

      streamRound += 1
      if (streamRound === 1) {
        return toStream([
          {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'tool_use',
              id: 'tool_skill_1',
              name: 'read_file',
              input: { path: skillFilePath }
            }
          },
          {
            type: 'content_block_start',
            index: 1,
            content_block: {
              type: 'tool_use',
              id: 'tool_skill_2',
              name: 'read_file',
              input: { path: skillFilePath }
            }
          }
        ])
      }

      return toStream([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' }
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Skill loaded' }
        }
      ])
    })

    const runtime = new AnthropicChatRuntime({
      usageStore: store,
      installedSkills: [
        {
          skillId: 'powerpoint',
          name: 'powerpoint',
          description: 'Use this skill for slide workflows.',
          skillDir,
          skillFilePath,
          body: '# Powerpoint',
          tags: []
        }
      ],
      toolsFactory: () => [readSkillTool]
    })

    const events: ChatEvent[] = []
    for await (const event of runtime.runTurn({
      sessionId: 's_skill',
      userText: 'Please help with my presentation',
      history: []
    })) {
      events.push(event)
    }

    const firstCallArgs = messagesCreateMock.mock.calls[0]?.[0] as { system?: string }
    expect(firstCallArgs.system).toContain('Installed skills:')
    expect(firstCallArgs.system).toContain('powerpoint | powerpoint')
    expect(firstCallArgs.system).toContain('~/.deepclaw/skills/powerpoint/SKILL.md')

    const skillRecords = await store.listSkillUsageRecords()
    expect(skillRecords).toHaveLength(1)
    expect(skillRecords[0]?.skillId).toBe('powerpoint')
    expect(skillRecords[0]?.toolCallId).toBe('tool_skill_1')
    expect(events.at(-1)?.type).toBe('assistant.completed')
  })

  it('serializes tool image artifacts into Anthropic tool_result content blocks', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.NOTEMARK_MODEL_PROVIDER = 'anthropic'
    process.env.NOTEMARK_MODEL = 'claude-sonnet-4-5'

    const imagePath = path.join(os.tmpdir(), `notemark-tool-image-${Date.now()}.png`)
    await writeFile(
      imagePath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn9v0wAAAAASUVORK5CYII=',
        'base64'
      )
    )

    try {
      let streamRound = 0
      messagesCreateMock.mockImplementation(async (params: { stream?: boolean }) => {
        if (!params.stream) {
          return {
            content: [{ type: 'text', text: 'pong' }]
          }
        }

        streamRound += 1
        if (streamRound === 1) {
          return toStream([
            {
              type: 'content_block_start',
              index: 0,
              content_block: {
                type: 'tool_use',
                id: 'tool_image_1',
                name: 'artifact_tool',
                input: {}
              }
            }
          ])
        }

        return toStream([
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' }
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Analyzed image' }
          }
        ])
      })

      const artifactTool: Tool = {
        name: 'artifact_tool',
        label: 'Artifact Tool',
        description: 'Returns an image artifact',
        inputSchema: { type: 'object' },
        execute: async () => ({
          content: [{ type: 'text', text: 'Captured screenshot' }],
          artifacts: [
            {
              id: 'artifact-image',
              fileName: 'artifact.png',
              mimeType: 'image/png',
              filePath: imagePath,
              sizeBytes: 68,
              width: 1,
              height: 1
            }
          ],
          details: { summary: 'Captured screenshot' }
        })
      }

      const runtime = new AnthropicChatRuntime({
        toolsFactory: () => [artifactTool]
      })

      const events: ChatEvent[] = []
      for await (const event of runtime.runTurn({
        sessionId: 's_artifact',
        userText: 'Inspect the screen',
        history: []
      })) {
        events.push(event)
      }

      const toolCompleted = events.find(
        (event): event is Extract<ChatEvent, { type: 'tool.completed' }> =>
          event.type === 'tool.completed'
      )
      expect(toolCompleted?.artifacts).toHaveLength(1)

      const secondCallArgs = messagesCreateMock.mock.calls[1]?.[0] as {
        messages?: Array<{ role: string; content: unknown }>
      }
      const toolResultMessage = secondCallArgs.messages?.at(-1)
      expect(toolResultMessage?.role).toBe('user')
      expect(toolResultMessage?.content).toMatchObject([
        {
          type: 'tool_result',
          tool_use_id: 'tool_image_1',
          content: [
            {
              type: 'text',
              text: 'Captured screenshot'
            },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png'
              }
            }
          ]
        }
      ])
    } finally {
      await unlink(imagePath).catch(() => undefined)
    }
  })

  it('injects persistent memory and session memory into the system prompt', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.NOTEMARK_MODEL_PROVIDER = 'anthropic'
    process.env.NOTEMARK_MODEL = 'claude-sonnet-4-5'

    messagesCreateMock.mockImplementation(async (params: { stream?: boolean }) => {
      if (!params.stream) {
        return {
          content: [{ type: 'text', text: 'pong' }]
        }
      }

      return toStream([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' }
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Using memory' }
        }
      ])
    })

    const runtime = new AnthropicChatRuntime()
    const latestUserMessage: ChatEvent = {
      type: 'user.message',
      eventId: 'u_latest',
      sessionId: 's_memory',
      timestamp: 3,
      messageId: 'u_latest',
      text: 'Continue from the summary'
    }

    const events: ChatEvent[] = []
    for await (const event of runtime.runTurn({
      sessionId: 's_memory',
      userText: 'Continue from the summary',
      persistentMemory: 'MEMORY (your personal notes) [5% - 100/2200 chars]\nProject uses pnpm.',
      sessionMemory: '## Goal\nContinue the migration',
      history: [latestUserMessage]
    })) {
      events.push(event)
    }

    const firstCallArgs = messagesCreateMock.mock.calls[0]?.[0] as {
      system?: string
      messages?: Array<{ role: string; content: unknown }>
    }

    expect(firstCallArgs.system).toContain('Persistent memory:')
    expect(firstCallArgs.system).toContain('Project uses pnpm.')
    expect(firstCallArgs.system).toContain('Session memory:')
    expect(firstCallArgs.system).toContain('## Goal\nContinue the migration')
    expect(firstCallArgs.messages).toEqual([
      {
        role: 'user',
        content: 'Continue from the summary'
      }
    ])
    expect(events.at(-1)?.type).toBe('assistant.completed')
  })

  it('retries idempotent tools on transient faults and reports structured fault metadata', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    process.env.NOTEMARK_MODEL_PROVIDER = 'anthropic'
    process.env.NOTEMARK_MODEL = 'claude-sonnet-4-5'

    let streamRound = 0
    let executeAttempts = 0

    messagesCreateMock.mockImplementation(async (params: { stream?: boolean }) => {
      if (!params.stream) {
        return {
          content: [{ type: 'text', text: 'pong' }]
        }
      }

      streamRound += 1
      if (streamRound === 1) {
        return toStream([
          {
            type: 'content_block_start',
            index: 0,
            content_block: {
              type: 'tool_use',
              id: 'tool_retry_1',
              name: 'retry_tool',
              input: {}
            }
          }
        ])
      }

      return toStream([
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' }
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Recovered' }
        }
      ])
    })

    const retryTool: Tool = {
      name: 'retry_tool',
      label: 'Retry Tool',
      description: 'Flaky but retryable tool',
      inputSchema: { type: 'object' },
      idempotent: true,
      faultTolerance: {
        maxRetries: 2,
        baseDelayMs: 0,
        maxJitterMs: 0,
        timeoutMs: 1_000
      },
      execute: async () => {
        executeAttempts += 1
        if (executeAttempts < 3) {
          throw new Error('network timeout while reaching upstream service')
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true, value: 'done' }) }],
          details: { summary: 'done' }
        }
      }
    }

    const runtime = new AnthropicChatRuntime({
      toolsFactory: () => [retryTool]
    })

    const events: ChatEvent[] = []
    for await (const event of runtime.runTurn({
      sessionId: 's_retry',
      userText: 'retry this tool',
      history: []
    })) {
      events.push(event)
    }

    const toolCompleted = events.find(
      (event): event is Extract<ChatEvent, { type: 'tool.completed' }> =>
        event.type === 'tool.completed'
    )

    expect(executeAttempts).toBe(3)
    expect(toolCompleted).toBeDefined()
    expect(toolCompleted?.isError).toBe(false)
    expect(toolCompleted?.attemptCount).toBe(3)
    expect(toolCompleted?.retryCount).toBe(2)
    expect(toolCompleted?.validationStatus).toBe('skipped')
  })
})
