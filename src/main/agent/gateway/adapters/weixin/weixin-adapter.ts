import type {
  ChannelAccount,
  ChannelAdapter,
  ChannelAdapterContext,
  GatewayAccountHealth,
  OutboundMessage
} from '../../types'
import { normalizeWeixinInbound } from './normalize'
import { createWeixinProtocolClient, type WeixinProtocolClient } from './protocol'

type WeixinRuntimeState = {
  account: ChannelAccount
  context: ChannelAdapterContext
  abortController: AbortController
  loopPromise: Promise<void>
  health: GatewayAccountHealth
  getUpdatesBuf: string
  nextPollTimeoutMs: number
  contextTokenByPeer: Map<string, string>
}

type WeixinChannelAdapterOptions = {
  stateDir?: string
  client?: WeixinProtocolClient
  now?: () => number
  retryDelayMs?: number
  backoffDelayMs?: number
  maxConsecutiveFailures?: number
  defaultLongPollTimeoutMs?: number
}

const DEFAULT_RETRY_DELAY_MS = 2000
const DEFAULT_BACKOFF_DELAY_MS = 30000
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35000
const DEFAULT_PAUSED_UNTIL = null

const toConfigString = (account: ChannelAccount, key: string): string | undefined => {
  const value = account.config[key]
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed || undefined
}

const sleep = async (ms: number, signal: AbortSignal): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms)
    const onAbort = (): void => {
      clearTimeout(timeout)
      reject(new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export class WeixinChannelAdapter implements ChannelAdapter {
  readonly channel = 'weixin'

  private readonly stateDir?: string

  private readonly client: WeixinProtocolClient

  private readonly now: () => number

  private readonly retryDelayMs: number

  private readonly backoffDelayMs: number

  private readonly maxConsecutiveFailures: number

  private readonly defaultLongPollTimeoutMs: number

  private readonly states = new Map<string, WeixinRuntimeState>()

  constructor(options: WeixinChannelAdapterOptions = {}) {
    this.stateDir = options.stateDir
    this.client = options.client ?? createWeixinProtocolClient()
    this.now = options.now ?? (() => Date.now())
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
    this.backoffDelayMs = options.backoffDelayMs ?? DEFAULT_BACKOFF_DELAY_MS
    this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES
    this.defaultLongPollTimeoutMs = options.defaultLongPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS
  }

  async startAccount(account: ChannelAccount, context: ChannelAdapterContext): Promise<void> {
    const existing = this.states.get(account.accountId)
    if (existing) {
      await this.stopAccount(account.accountId)
    }

    const baseUrl = toConfigString(account, 'baseUrl')
    if (!baseUrl) {
      throw new Error(`weixin account ${account.accountId} missing baseUrl config`)
    }

    const health: GatewayAccountHealth = {
      channel: this.channel,
      accountId: account.accountId,
      status: 'running',
      lastEventAt: this.now(),
      lastInboundAt: null,
      lastError: null,
      consecutiveFailures: 0,
      pausedUntil: DEFAULT_PAUSED_UNTIL
    }

    const abortController = new AbortController()
    const state: WeixinRuntimeState = {
      account,
      context,
      abortController,
      loopPromise: Promise.resolve(),
      health,
      getUpdatesBuf: '',
      nextPollTimeoutMs: this.defaultLongPollTimeoutMs,
      contextTokenByPeer: new Map<string, string>()
    }
    state.loopPromise = this.runPollLoop(state)
    this.states.set(account.accountId, state)
    context.log('info', '[gateway-weixin] started account poller', {
      accountId: account.accountId,
      baseUrl,
      stateDir: this.stateDir
    })
  }

  async stopAccount(accountId: string): Promise<void> {
    const state = this.states.get(accountId)
    if (!state) {
      return
    }

    state.abortController.abort()
    try {
      await state.loopPromise
    } catch {
      // ignore aborted loop
    } finally {
      state.health.status = 'stopped'
      state.health.lastEventAt = this.now()
      state.health.pausedUntil = DEFAULT_PAUSED_UNTIL
      this.states.delete(accountId)
    }
  }

  async stopAll(): Promise<void> {
    const all = [...this.states.keys()]
    await Promise.allSettled(all.map((accountId) => this.stopAccount(accountId)))
  }

  async sendFinal(account: ChannelAccount, outbound: OutboundMessage): Promise<void> {
    const state = this.states.get(account.accountId)
    const baseUrl = toConfigString(account, 'baseUrl')
    if (!baseUrl) {
      throw new Error(`weixin account ${account.accountId} missing baseUrl config`)
    }

    const routeTag = toConfigString(account, 'routeTag')
    const channelVersion = toConfigString(account, 'channelVersion')
    const text = outbound.text.trim()
    if (!text) {
      return
    }

    const contextToken = state?.contextTokenByPeer.get(outbound.peerId)
    await this.client.sendTextMessage({
      baseUrl,
      token: account.token,
      routeTag,
      channelVersion,
      timeoutMs: this.defaultLongPollTimeoutMs,
      toUserId: outbound.peerId,
      text,
      contextToken,
      signal: state?.abortController.signal
    })

    if (state) {
      state.health.lastEventAt = this.now()
      state.health.lastError = null
    }
  }

  getHealth(accountId: string): GatewayAccountHealth | null {
    const state = this.states.get(accountId)
    if (!state) {
      return null
    }
    return { ...state.health }
  }

  private async runPollLoop(state: WeixinRuntimeState): Promise<void> {
    const { account, context, abortController } = state
    const baseUrl = toConfigString(account, 'baseUrl')
    if (!baseUrl) {
      return
    }

    const routeTag = toConfigString(account, 'routeTag')
    const channelVersion = toConfigString(account, 'channelVersion')

    while (!abortController.signal.aborted) {
      try {
        const response = await this.client.getUpdates({
          baseUrl,
          token: account.token,
          routeTag,
          channelVersion,
          timeoutMs: state.nextPollTimeoutMs,
          getUpdatesBuf: state.getUpdatesBuf,
          signal: abortController.signal
        })

        state.health.lastEventAt = this.now()
        state.health.status = 'running'
        state.health.lastError = null
        state.health.pausedUntil = DEFAULT_PAUSED_UNTIL

        if (typeof response.longpolling_timeout_ms === 'number' && response.longpolling_timeout_ms > 0) {
          state.nextPollTimeoutMs = response.longpolling_timeout_ms
        }

        const apiError = (response.ret != null && response.ret !== 0) ||
          (response.errcode != null && response.errcode !== 0)
        if (apiError) {
          throw new Error(
            `weixin getupdates failed: ret=${response.ret} errcode=${response.errcode} errmsg=${response.errmsg ?? ''}`
          )
        }

        if (response.get_updates_buf) {
          state.getUpdatesBuf = response.get_updates_buf
        }

        state.health.consecutiveFailures = 0
        const messages = response.msgs ?? []
        for (const message of messages) {
          const inbound = normalizeWeixinInbound({
            accountId: account.accountId,
            channel: this.channel,
            message
          })
          if (!inbound) {
            continue
          }

          const contextToken = message.context_token?.trim()
          if (contextToken) {
            state.contextTokenByPeer.set(inbound.peerId, contextToken)
          }

          try {
            await context.onInbound(inbound)
            state.health.lastInboundAt = this.now()
            state.health.lastEventAt = this.now()
          } catch (error) {
            context.log('error', '[gateway-weixin] inbound dispatch failed', {
              accountId: account.accountId,
              peerId: inbound.peerId,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          break
        }
        state.health.consecutiveFailures += 1
        state.health.status = 'error'
        state.health.lastError = error instanceof Error ? error.message : String(error)
        state.health.lastEventAt = this.now()
        context.log('warn', '[gateway-weixin] poll loop error', {
          accountId: account.accountId,
          error: state.health.lastError,
          consecutiveFailures: state.health.consecutiveFailures
        })
        try {
          const shouldBackoff = state.health.consecutiveFailures >= this.maxConsecutiveFailures
          if (shouldBackoff) {
            state.health.pausedUntil = this.now() + this.backoffDelayMs
            state.health.consecutiveFailures = 0
            await sleep(this.backoffDelayMs, abortController.signal)
            continue
          }
          state.health.pausedUntil = this.now() + this.retryDelayMs
          await sleep(this.retryDelayMs, abortController.signal)
        } catch {
          break
        }
      }
    }
  }
}
