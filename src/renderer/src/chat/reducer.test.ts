import { describe, expect, it } from 'vitest'
import type { SessionSnapshot } from '@shared/models'
import {
  applyChatEvent,
  createInitialChatViewState,
  replaySession,
  selectVisibleSessions
} from './reducer'

describe('chat reducer', () => {
  it('replays transcript events and aggregates tool calls into one assistant turn', () => {
    const snapshot: SessionSnapshot = {
      meta: {
        id: 'session-1',
        title: 'New chat',
        createdAt: 1,
        updatedAt: 10,
        messageCount: 2,
        status: 'idle'
      },
      events: [
        {
          type: 'session.created',
          eventId: 'created',
          sessionId: 'session-1',
          timestamp: 1,
          meta: {
            id: 'session-1',
            title: 'New chat',
            createdAt: 1,
            updatedAt: 1,
            messageCount: 0,
            status: 'idle'
          }
        },
        {
          type: 'user.message',
          eventId: 'user',
          sessionId: 'session-1',
          timestamp: 2,
          messageId: 'user-1',
          text: 'hello'
        },
        {
          type: 'assistant.started',
          eventId: 'assistant-start',
          sessionId: 'session-1',
          timestamp: 3,
          messageId: 'assistant-1'
        },
        {
          type: 'tool.group.started',
          eventId: 'group-start',
          sessionId: 'session-1',
          timestamp: 4,
          assistantMessageId: 'assistant-1',
          groupId: 'group-1'
        },
        {
          type: 'tool.called',
          eventId: 'tool-called',
          sessionId: 'session-1',
          timestamp: 5,
          assistantMessageId: 'assistant-1',
          groupId: 'group-1',
          requestRound: 1,
          toolCallId: 'tool-1',
          toolName: 'echo',
          argsSummary: '{"text":"hello"}'
        },
        {
          type: 'tool.completed',
          eventId: 'tool-completed',
          sessionId: 'session-1',
          timestamp: 6,
          assistantMessageId: 'assistant-1',
          groupId: 'group-1',
          requestRound: 1,
          toolCallId: 'tool-1',
          toolName: 'echo',
          outputSummary: 'hello',
          durationMs: 8,
          isError: false,
          roundInputTokens: 12,
          roundOutputTokens: 6,
          roundCacheCreationTokens: 0,
          roundCacheReadTokens: 0,
          roundToolCallCount: 1
        },
        {
          type: 'assistant.delta',
          eventId: 'delta',
          sessionId: 'session-1',
          timestamp: 7,
          messageId: 'assistant-1',
          delta: 'Hi there'
        },
        {
          type: 'assistant.completed',
          eventId: 'assistant-completed',
          sessionId: 'session-1',
          timestamp: 8,
          messageId: 'assistant-1',
          text: 'Hi there',
          durationMs: 20
        }
      ]
    }

    const state = replaySession(snapshot)
    const assistant = state.transcript.find((entry) => entry.kind === 'assistant')

    expect(assistant?.kind).toBe('assistant')
    if (assistant?.kind === 'assistant') {
      expect(assistant.text).toBe('Hi there')
      expect(assistant.toolGroup?.calls).toHaveLength(1)
      expect(assistant.toolGroup?.summary).toContain('1 tool')
    }
  })

  it('ignores duplicated assistant delta events by event id', () => {
    const initial = createInitialChatViewState()
    const started = applyChatEvent(initial, {
      type: 'assistant.started',
      eventId: 'start',
      sessionId: 'session',
      timestamp: 1,
      messageId: 'assistant-1'
    })

    const deltaEvent = {
      type: 'assistant.delta' as const,
      eventId: 'same-delta',
      sessionId: 'session',
      timestamp: 2,
      messageId: 'assistant-1',
      delta: 'Hello'
    }

    const afterFirst = applyChatEvent(started, deltaEvent)
    const afterSecond = applyChatEvent(afterFirst, deltaEvent)
    const assistant = afterSecond.transcript.find((entry) => entry.kind === 'assistant')

    expect(assistant?.kind).toBe('assistant')
    if (assistant?.kind === 'assistant') {
      expect(assistant.text).toBe('Hello')
    }
  })

  it('keeps only the latest ten sessions for the sidebar', () => {
    const visible = selectVisibleSessions(
      Array.from({ length: 12 }, (_, index) => ({
        id: String(index),
        title: `Session ${index}`,
        createdAt: index,
        updatedAt: index,
        messageCount: index,
        status: 'idle' as const
      }))
    )

    expect(visible).toHaveLength(10)
    expect(visible[0]?.updatedAt).toBe(11)
    expect(visible[visible.length - 1]?.updatedAt).toBe(2)
  })
})
