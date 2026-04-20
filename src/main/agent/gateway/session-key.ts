import type { InboundMessage } from './types'

const sanitizeSessionPart = (value: string): string => {
  const normalized = value.trim().toLowerCase()
  if (!normalized) {
    return 'unknown'
  }
  return normalized.replace(/[^a-z0-9._:-]/g, '_')
}

export const buildSessionId = (inbound: Pick<InboundMessage, 'channel' | 'accountId' | 'peerId'>): string =>
  `${sanitizeSessionPart(inbound.channel)}:${sanitizeSessionPart(inbound.accountId)}:${sanitizeSessionPart(inbound.peerId)}`
