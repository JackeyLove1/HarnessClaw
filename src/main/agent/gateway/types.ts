export interface InboundMedia {
  kind: 'image' | 'video' | 'audio' | 'file' | 'other'
  mimeType?: string
  name?: string
  url?: string
  localPath?: string
  sizeBytes?: number
}

export interface InboundMessage {
  text: string
  senderId: string
  channel: string
  accountId: string
  peerId: string
  isGroup: boolean
  media: InboundMedia[]
  raw: Record<string, unknown>
}

export interface ChannelAccount {
  channel: string
  accountId: string
  token?: string
  config: Record<string, unknown>
}

export interface OutboundMessage {
  sessionId: string
  text: string
  channel: string
  accountId: string
  peerId: string
  senderId: string
  isGroup: boolean
  raw: Record<string, unknown>
}

export type GatewayAccountStatus = 'idle' | 'running' | 'paused' | 'error' | 'stopped'

export interface GatewayAccountHealth {
  channel: string
  accountId: string
  status: GatewayAccountStatus
  lastEventAt: number | null
  lastInboundAt: number | null
  lastError: string | null
  consecutiveFailures: number
  pausedUntil: number | null
}

export interface ChannelAdapterContext {
  onInbound: (inbound: InboundMessage) => Promise<void>
  log: (level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: unknown) => void
}

export interface ChannelAdapter {
  readonly channel: string
  startAccount: (account: ChannelAccount, context: ChannelAdapterContext) => Promise<void>
  stopAccount: (accountId: string) => Promise<void>
  stopAll?: () => Promise<void>
  sendFinal: (account: ChannelAccount, outbound: OutboundMessage) => Promise<void>
  getHealth: (accountId: string) => GatewayAccountHealth | null
}

export interface GatewayRouteResult {
  sessionId: string
  inbound: InboundMessage
  outbound: OutboundMessage
}
