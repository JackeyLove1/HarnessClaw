import { describe, expect, it } from 'vitest'
import type { ChatEvent } from '@shared/models'
import {
  clampText,
  extractTextContent,
  fallbackTitle,
  sanitizeTitle,
  summarizeValue,
  toAnthropicMessages
} from './text-utils'

describe('runtime text utils', () => {
  it('clamps and normalizes text content', () => {
    expect(clampText('  hello   world  ')).toBe('hello world')
    expect(clampText('abcdef', 4)).toBe('abc…')
  })

  it('extracts text-only content from mixed content arrays', () => {
    const content = [
      { type: 'text', text: 'first' },
      { type: 'tool', text: 'ignored' },
      { type: 'text', text: 'second' }
    ]

    expect(extractTextContent(content)).toBe('first second')
  })

  it('summarizes objects and sanitizes generated titles', () => {
    expect(summarizeValue({ foo: 'bar' })).toContain('"foo":"bar"')
    expect(sanitizeTitle('  "Roadmap chat" ', 'fallback')).toBe('Roadmap chat')
    expect(sanitizeTitle('   ', 'fallback')).toBe('fallback')
  })

  it('creates fallback title and maps user/assistant messages only', () => {
    const history: ChatEvent[] = [
      {
        type: 'session.created',
        eventId: 'e1',
        sessionId: 's1',
        timestamp: 1,
        meta: {
          id: 's1',
          title: 'New chat',
          createdAt: 1,
          updatedAt: 1,
          messageCount: 0,
          status: 'idle'
        }
      },
      {
        type: 'user.message',
        eventId: 'e2',
        sessionId: 's1',
        timestamp: 2,
        messageId: 'u1',
        text: 'Hello'
      },
      {
        type: 'assistant.completed',
        eventId: 'e3',
        sessionId: 's1',
        timestamp: 3,
        messageId: 'a1',
        text: 'Hi there',
        durationMs: 20
      }
    ]

    expect(fallbackTitle('')).toMatch(/^Chat /)
    expect(toAnthropicMessages(history)).toEqual([
      {
        role: 'user',
        content: 'Hello'
      },
      {
        role: 'assistant',
        content: 'Hi there'
      }
    ])
  })
})
