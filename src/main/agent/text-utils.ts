import type { ChatEvent } from '@shared/models'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'

export const clampText = (value: unknown, maxLength = 280): string => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

export const clampTextPreserveLayout = (value: unknown, maxLength = 280): string => {
  const text = String(value ?? '')
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

export const extractTextContent = (content: unknown): string => {
  if (!Array.isArray(content)) return ''

  return clampText(
    content
      .filter(
        (item): item is { type: string; text: string } =>
          Boolean(item) &&
          typeof item === 'object' &&
          'type' in item &&
          'text' in item &&
          (item as { type?: unknown }).type === 'text' &&
          typeof (item as { text?: unknown }).text === 'string'
      )
      .map((item) => item.text)
      .join(' ')
  )
}

export const summarizeValue = (value: unknown, maxLength = 220): string => {
  if (value == null) return ''
  if (typeof value === 'string') return clampText(value, maxLength)

  try {
    return clampText(JSON.stringify(value), maxLength)
  } catch {
    return clampText(String(value), maxLength)
  }
}

export const sanitizeTitle = (value: unknown, fallback: string): string => {
  const cleaned = clampText(String(value ?? '').replace(/^["'\s]+|["'\s]+$/g, ''), 60)
  return cleaned || fallback
}

export const fallbackTitle = (userText: string, createdAt = Date.now()): string => {
  const candidate = clampText(userText, 60)

  if (candidate) {
    return candidate
  }

  return `Chat ${new Date(createdAt).toLocaleString()}`
}

export const toAnthropicMessages = (history: ChatEvent[]): MessageParam[] => {
  if (!Array.isArray(history)) return []

  return history.flatMap((event): MessageParam[] => {
    if (event.type === 'user.message') {
      return [
        {
          role: 'user',
          content: event.text
        }
      ]
    }

    if (event.type === 'assistant.completed') {
      return [
        {
          role: 'assistant',
          content: event.text
        }
      ]
    }

    return []
  })
}
