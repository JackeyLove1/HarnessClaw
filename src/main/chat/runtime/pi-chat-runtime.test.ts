import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '@shared/models'

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

import { AnthropicChatRuntime } from './pi-chat-runtime'

const ORIGINAL_ENV = { ...process.env }

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

afterEach(() => {
  resetEnv()
  messagesCreateMock.mockReset()
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
              name: 'echo',
              input: { text: 'hello tool' }
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

    const completed = events.find((event): event is Extract<ChatEvent, { type: 'assistant.completed' }> => {
      return event.type === 'assistant.completed'
    })
    expect(completed?.text).toBe('Checking done')
  })
})
