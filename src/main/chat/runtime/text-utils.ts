import type { ChatEvent } from '@shared/models'

export const clampText = (value: unknown, maxLength = 280): string => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
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

export const toAgentMessages = (
  history: ChatEvent[]
): Array<{
  role: 'user' | 'assistant'
  timestamp: number
  content: Array<{ type: 'text'; text: string }>
}> => {
  if (!Array.isArray(history)) return []

  type AgentMessage = {
    role: 'user' | 'assistant'
    timestamp: number
    content: Array<{ type: 'text'; text: string }>
  }

  return history.flatMap((event): AgentMessage[] => {
    if (event.type === 'user.message') {
      return [
        {
          role: 'user',
          timestamp: event.timestamp,
          content: [{ type: 'text', text: event.text }]
        }
      ]
    }

    if (event.type === 'assistant.completed') {
      return [
        {
          role: 'assistant',
          timestamp: event.timestamp,
          content: [{ type: 'text', text: event.text }]
        }
      ]
    }

    return []
  })
}
