import Anthropic from '@anthropic-ai/sdk'
import type { ChatEvent } from '@shared/models'
import { ChatSessionStore } from '../../chat/session-store'
import { getAnthropicApiKey, resolveRuntimeConfig } from '../config'
import { clampText, clampTextPreserveLayout } from '../text-utils'
import type { SessionMemoryCompactor } from './types'

const MAX_EVENT_TEXT = 1_200
const MAX_SESSION_MEMORY_CHARS = 8_000
const MAX_SUMMARY_TOKENS = 1_024

type UsageSnapshot = {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

const EMPTY_USAGE: UsageSnapshot = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0
}

const SESSION_MEMORY_INSTRUCTIONS = `You maintain hidden session memory for a desktop AI assistant chat.

Write a concise structured summary that will be injected into future system prompts.

Requirements:
- Keep only durable, high-value context for continuing the session.
- Focus on user goals, constraints, decisions, progress, important files/data, and unresolved threads.
- Omit pleasantries, repetition, and low-signal intermediate chatter.
- If information is outdated or superseded by newer context, remove or replace it.
- Do not mention that this summary is hidden or injected.
- Keep the output compact and scannable.

Use this structure exactly:
## Goal
## Preferences
## Key Context
## Progress
## Open Threads`

const asFiniteNumber = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.trunc(value))
}

const toUsageSnapshot = (value: unknown): UsageSnapshot => {
  if (!value || typeof value !== 'object') {
    return EMPTY_USAGE
  }

  const usage = value as Record<string, unknown>
  return {
    inputTokens: asFiniteNumber(usage.input_tokens ?? usage.inputTokens),
    outputTokens: asFiniteNumber(usage.output_tokens ?? usage.outputTokens),
    cacheCreationTokens: asFiniteNumber(
      usage.cache_creation_input_tokens ?? usage.cacheCreationTokens
    ),
    cacheReadTokens: asFiniteNumber(usage.cache_read_input_tokens ?? usage.cacheReadTokens)
  }
}

const normalizeSummary = (value: string): string =>
  clampTextPreserveLayout(value.trim(), MAX_SESSION_MEMORY_CHARS)

const formatAttachmentSummary = (
  event: Extract<ChatEvent, { type: 'user.message' }>
): string | null => {
  const attachments = event.attachments ?? []
  if (attachments.length === 0) {
    return null
  }

  const names = attachments
    .map((attachment) => attachment.fileName)
    .filter(Boolean)
    .slice(0, 3)
  const suffix =
    names.length > 0
      ? ` (${names.join(', ')}${attachments.length > names.length ? ', ...' : ''})`
      : ''
  return `${attachments.length} image attachment${attachments.length === 1 ? '' : 's'}${suffix}`
}

const formatEventForSummary = (event: ChatEvent): string | null => {
  switch (event.type) {
    case 'user.message': {
      const parts: string[] = []
      const text = clampTextPreserveLayout(event.text, MAX_EVENT_TEXT)
      if (text) {
        parts.push(text)
      }

      const attachmentSummary = formatAttachmentSummary(event)
      if (attachmentSummary) {
        parts.push(attachmentSummary)
      }

      if (parts.length === 0) {
        return null
      }

      return `User: ${parts.join(' | ')}`
    }

    case 'assistant.completed': {
      const text = clampTextPreserveLayout(event.text, MAX_EVENT_TEXT)
      return text ? `Assistant: ${text}` : null
    }

    case 'tool.called': {
      const args = clampText(event.argsSummary, 300)
      return args
        ? `Tool called: ${event.toolName} | args: ${args}`
        : `Tool called: ${event.toolName}`
    }

    case 'tool.completed': {
      const output = clampTextPreserveLayout(event.outputSummary, 500)
      const status = event.isError ? 'error' : 'result'
      return output
        ? `Tool ${status}: ${event.toolName} | ${output}`
        : `Tool ${status}: ${event.toolName}`
    }

    case 'cron.delivery': {
      const text = clampTextPreserveLayout(event.text, MAX_EVENT_TEXT)
      return text ? `Scheduled delivery (${event.status}): ${text}` : null
    }

    default:
      return null
  }
}

export const selectSummarizableEvents = (events: ChatEvent[], afterTimestamp = 0): ChatEvent[] =>
  events.filter(
    (event) => event.timestamp > afterTimestamp && formatEventForSummary(event) !== null
  )

const formatHistoryForSummary = (events: ChatEvent[]): string => {
  const lines = events
    .map((event) => formatEventForSummary(event))
    .filter((line): line is string => Boolean(line))

  return lines.join('\n\n')
}

type AnthropicSessionMemoryCompactorOptions = {
  usageStore?: ChatSessionStore
}

export class AnthropicSessionMemoryCompactor implements SessionMemoryCompactor {
  private readonly usageStore: ChatSessionStore

  constructor(options: AnthropicSessionMemoryCompactorOptions = {}) {
    this.usageStore = options.usageStore ?? new ChatSessionStore()
  }

  async bootstrapSessionMemory({
    sessionId,
    history,
    signal
  }: {
    sessionId: string
    history: ChatEvent[]
    signal?: AbortSignal
  }): Promise<string> {
    const transcript = formatHistoryForSummary(history)
    if (!transcript.trim()) {
      return ''
    }

    return this.generateSummary({
      sessionId,
      prompt: `Create the first session memory from this transcript.

Transcript:
${transcript}`,
      signal
    })
  }

  async extendSessionMemory({
    sessionId,
    previousSummary,
    historyDelta,
    signal
  }: {
    sessionId: string
    previousSummary: string
    historyDelta: ChatEvent[]
    signal?: AbortSignal
  }): Promise<string> {
    const transcript = formatHistoryForSummary(historyDelta)
    if (!transcript.trim()) {
      return normalizeSummary(previousSummary)
    }

    return this.generateSummary({
      sessionId,
      prompt: `Update the session memory using the existing summary and the new session events.

Existing session memory:
${previousSummary.trim()}

New session events:
${transcript}`,
      signal
    })
  }

  private createClient(): Anthropic {
    const config = resolveRuntimeConfig()
    const apiKey = getAnthropicApiKey()
    if (!apiKey) {
      throw new Error(
        'Chat runtime is missing ANTHROPIC_API_KEY for the configured Anthropic model.'
      )
    }

    return new Anthropic({
      apiKey,
      baseURL: config.baseUrl
    })
  }

  private async generateSummary({
    sessionId,
    prompt,
    signal
  }: {
    sessionId: string
    prompt: string
    signal?: AbortSignal
  }): Promise<string> {
    const config = resolveRuntimeConfig()
    const client = this.createClient()
    const response = await client.messages.create(
      {
        model: config.model,
        max_tokens: MAX_SUMMARY_TOKENS,
        system: SESSION_MEMORY_INSTRUCTIONS,
        messages: [{ role: 'user', content: prompt }]
      },
      { signal }
    )

    const usage = toUsageSnapshot((response as { usage?: unknown }).usage)
    if (
      usage.inputTokens > 0 ||
      usage.outputTokens > 0 ||
      usage.cacheCreationTokens > 0 ||
      usage.cacheReadTokens > 0
    ) {
      try {
        await this.usageStore.appendUsageRecord({
          sessionId,
          assistantMessageId: null,
          requestRound: 1,
          kind: 'session_memory',
          model: config.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          cacheReadTokens: usage.cacheReadTokens
        })
      } catch (error) {
        console.warn('[usage] failed to persist session memory usage record', error)
      }
    }

    const summary = this.readAssistantText(response.content)
    return normalizeSummary(summary)
  }

  private readAssistantText(content: unknown): string {
    if (!Array.isArray(content)) return ''
    return content
      .filter(
        (block): block is { type: string; text: string } =>
          Boolean(block) &&
          typeof block === 'object' &&
          'type' in block &&
          'text' in block &&
          (block as { type?: unknown }).type === 'text' &&
          typeof (block as { text?: unknown }).text === 'string'
      )
      .map((block) => block.text)
      .join('')
      .trim()
  }
}

export const createSessionMemoryCompactor = (): SessionMemoryCompactor =>
  new AnthropicSessionMemoryCompactor()

export type { SessionMemoryCompactor } from './types'
