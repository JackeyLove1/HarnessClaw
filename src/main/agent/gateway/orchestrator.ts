import { ChatSupervisor } from '../../chat/supervisor'
import { GatewayRouter } from './router'
import type {
  ChannelAccount,
  ChannelAdapter,
  GatewayAccountHealth,
  InboundMessage,
  OutboundMessage
} from './types'

type AgentGatewayOrchestratorOptions = {
  supervisor: ChatSupervisor
  log?: (level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: unknown) => void
}

const toAccountKey = (channel: string, accountId: string): string =>
  `${channel.trim().toLowerCase()}:${accountId.trim()}`

export class AgentGatewayOrchestrator {
  private readonly adapters = new Map<string, ChannelAdapter>()

  private readonly accounts = new Map<string, ChannelAccount>()

  private readonly router: GatewayRouter

  private readonly log: Required<AgentGatewayOrchestratorOptions>['log']

  constructor(options: AgentGatewayOrchestratorOptions) {
    this.log = options.log ?? ((level, message, data) => console[level](`[gateway] ${message}`, data))
    this.router = new GatewayRouter({
      supervisor: options.supervisor,
      onSendFinal: this.sendFinal.bind(this),
      log: this.log
    })
  }

  registerAdapter(adapter: ChannelAdapter): void {
    const channel = adapter.channel.trim().toLowerCase()
    if (!channel) {
      throw new Error('Adapter channel is required.')
    }
    this.adapters.set(channel, adapter)
    this.log('info', 'registered channel adapter', { channel })
  }

  async startAccount(account: ChannelAccount): Promise<void> {
    const channel = account.channel.trim().toLowerCase()
    const accountKey = toAccountKey(channel, account.accountId)
    const adapter = this.adapters.get(channel)
    if (!adapter) {
      throw new Error(`No gateway adapter registered for channel: ${channel}`)
    }

    if (this.accounts.has(accountKey)) {
      await adapter.stopAccount(account.accountId)
    }

    this.accounts.set(accountKey, { ...account, channel })
    await adapter.startAccount(
      { ...account, channel },
      {
        onInbound: (inbound) => this.handleInbound(inbound),
        log: this.log
      }
    )
    this.log('info', 'started channel account', { channel, accountId: account.accountId })
  }

  async stopAccount(channel: string, accountId: string): Promise<void> {
    const normalizedChannel = channel.trim().toLowerCase()
    const adapter = this.adapters.get(normalizedChannel)
    if (!adapter) {
      return
    }
    await adapter.stopAccount(accountId)
    this.accounts.delete(toAccountKey(normalizedChannel, accountId))
    this.log('info', 'stopped channel account', { channel: normalizedChannel, accountId })
  }

  async stopAll(): Promise<void> {
    const tasks: Promise<void>[] = []
    for (const [channel, adapter] of this.adapters) {
      if (adapter.stopAll) {
        tasks.push(adapter.stopAll())
        continue
      }

      for (const account of this.accounts.values()) {
        if (account.channel === channel) {
          tasks.push(adapter.stopAccount(account.accountId))
        }
      }
    }

    await Promise.allSettled(tasks)
    this.accounts.clear()
    this.log('info', 'stopped all channel accounts')
  }

  health(): GatewayAccountHealth[] {
    const snapshots: GatewayAccountHealth[] = []
    for (const account of this.accounts.values()) {
      const adapter = this.adapters.get(account.channel)
      if (!adapter) {
        continue
      }
      const snapshot = adapter.getHealth(account.accountId)
      if (snapshot) {
        snapshots.push(snapshot)
      }
    }
    return snapshots
  }

  private async handleInbound(inbound: InboundMessage): Promise<void> {
    try {
      await this.router.normalizeAndDispatch(inbound)
    } catch (error) {
      this.log('error', 'failed to process inbound message', {
        channel: inbound.channel,
        accountId: inbound.accountId,
        peerId: inbound.peerId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async sendFinal(inbound: InboundMessage, outbound: OutboundMessage): Promise<void> {
    const account = this.accounts.get(toAccountKey(inbound.channel, inbound.accountId))
    if (!account) {
      throw new Error(`Gateway account not found: ${inbound.channel}:${inbound.accountId}`)
    }

    const adapter = this.adapters.get(account.channel)
    if (!adapter) {
      throw new Error(`Channel adapter not found: ${account.channel}`)
    }

    await adapter.sendFinal(account, outbound)
  }
}

export const createAgentGatewayOrchestrator = (
  options: AgentGatewayOrchestratorOptions
): AgentGatewayOrchestrator => new AgentGatewayOrchestrator(options)
