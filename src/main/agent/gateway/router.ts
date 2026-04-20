import type { ChatEvent } from '@shared/models'
import type { SendMessageInput } from '@shared/types'
import { ChatSupervisor } from '../../chat/supervisor'
import { ChatSessionStore } from '../../chat/session-store'
import { buildSessionId } from './session-key'
import type { GatewayRouteResult, InboundMessage, OutboundMessage } from './types'

type GatewayRouterOptions = {
  supervisor: ChatSupervisor
  store?: ChatSessionStore
  onSendFinal: (inbound: InboundMessage, outbound: OutboundMessage) => Promise<void>
  log?: (level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: unknown) => void
}

const isAssistantCompleted = (
  event: ChatEvent
): event is Extract<ChatEvent, { type: 'assistant.completed' }> => event.type === 'assistant.completed'

const isSessionError = (event: ChatEvent): event is Extract<ChatEvent, { type: 'session.error' }> =>
  event.type === 'session.error'

const parseSkills = (raw: Record<string, unknown>): string[] => {
  const value = raw.skills
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim())
}

const normalizeUserText = (inbound: InboundMessage): string => {
  const trimmed = inbound.text.trim()
  if (trimmed) {
    return trimmed
  }
  if (inbound.media.length > 0) {
    return `[media message: ${inbound.media.length} item(s)]`
  }
  return ''
}

export class GatewayRouter {
  private readonly supervisor: ChatSupervisor

  private readonly store: ChatSessionStore

  private readonly onSendFinal: GatewayRouterOptions['onSendFinal']

  private readonly log: Required<GatewayRouterOptions>['log']

  constructor(options: GatewayRouterOptions) {
    this.supervisor = options.supervisor
    this.store = options.store ?? new ChatSessionStore()
    this.onSendFinal = options.onSendFinal
    this.log = options.log ?? (() => undefined)
  }

  async normalizeAndDispatch(inbound: InboundMessage): Promise<GatewayRouteResult | null> {
    const userText = normalizeUserText(inbound)
    if (!userText) {
      this.log('warn', '[gateway] skip empty inbound message', {
        channel: inbound.channel,
        accountId: inbound.accountId,
        peerId: inbound.peerId
      })
      return null
    }

    const sessionId = buildSessionId(inbound)
    await this.ensureSessionExists(sessionId)

    const before = await this.supervisor.openSession(sessionId)
    const beforeIds = new Set(before.events.map((event) => event.eventId))

    const payload: SendMessageInput = {
      text: userText,
      attachments: [],
      skills: parseSkills(inbound.raw)
    }

    await this.supervisor.sendMessage(sessionId, payload)

    const after = await this.supervisor.openSession(sessionId)
    const newEvents = after.events.filter((event) => !beforeIds.has(event.eventId))
    const assistantCompleted = [...newEvents].reverse().find(isAssistantCompleted)
    if (!assistantCompleted) {
      const latestError = [...newEvents].reverse().find(isSessionError)
      throw new Error(latestError?.message ?? 'Agent finished without assistant.completed event.')
    }

    const outbound: OutboundMessage = {
      sessionId,
      text: assistantCompleted.text,
      channel: inbound.channel,
      accountId: inbound.accountId,
      peerId: inbound.peerId,
      senderId: inbound.senderId,
      isGroup: inbound.isGroup,
      raw: {
        sourceEventId: assistantCompleted.eventId,
        sourceMessageId: assistantCompleted.messageId
      }
    }

    await this.onSendFinal(inbound, outbound)
    return { sessionId, inbound, outbound }
  }

  private async ensureSessionExists(sessionId: string): Promise<void> {
    try {
      await this.store.readMeta(sessionId)
    } catch {
      await this.store.createSession(sessionId)
      this.log('info', '[gateway] created channel session', { sessionId })
    }
  }
}
