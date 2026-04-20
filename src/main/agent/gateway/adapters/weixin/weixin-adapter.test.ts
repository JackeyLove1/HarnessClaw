import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChannelAccount, ChannelAdapterContext, OutboundMessage } from '../../types'
import { WeixinChannelAdapter } from './weixin-adapter'
import type {
  WeixinGetUpdatesResponse,
  WeixinProtocolClient,
  WeixinProtocolRequestOptions
} from './protocol'

const createAccount = (): ChannelAccount => ({
  channel: 'weixin',
  accountId: 'bot001',
  token: 'token_1',
  config: {
    baseUrl: 'https://weixin.example.com',
    routeTag: 'route-a',
    channelVersion: '65547'
  }
})

const createContext = (): ChannelAdapterContext => ({
  onInbound: vi.fn(async () => undefined),
  log: vi.fn()
})

const waitFor = async (predicate: () => boolean, timeoutMs = 1000): Promise<void> => {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timeout')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const createAbortError = (): Error => {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('WeixinChannelAdapter', () => {
  it('polls inbound text and reuses context token for sendFinal', async () => {
    const sendTextMessage = vi.fn(async () => undefined)
    let callCount = 0
    const client: WeixinProtocolClient = {
      getUpdates: vi.fn(async (options) => {
        if (callCount === 0) {
          callCount += 1
          return {
            ret: 0,
            msgs: [
              {
                from_user_id: 'user_1',
                message_type: 1,
                context_token: 'ctx_001',
                item_list: [{ type: 1, text_item: { text: 'hello' } }]
              }
            ],
            get_updates_buf: 'buf_1'
          } satisfies WeixinGetUpdatesResponse
        }
        return new Promise<WeixinGetUpdatesResponse>((_, reject) => {
          options.signal?.addEventListener('abort', () => reject(createAbortError()), { once: true })
        })
      }),
      sendTextMessage
    }

    const adapter = new WeixinChannelAdapter({ client })
    const account = createAccount()
    const context = createContext()
    await adapter.startAccount(account, context)
    await waitFor(() => (context.onInbound as ReturnType<typeof vi.fn>).mock.calls.length > 0)

    const outbound: OutboundMessage = {
      sessionId: 'weixin:bot001:user_1',
      text: 'reply text',
      channel: 'weixin',
      accountId: 'bot001',
      peerId: 'user_1',
      senderId: 'bot001',
      isGroup: false,
      raw: {}
    }
    await adapter.sendFinal(account, outbound)

    expect(context.onInbound).toHaveBeenCalledTimes(1)
    expect(sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        toUserId: 'user_1',
        text: 'reply text',
        contextToken: 'ctx_001'
      })
    )
    await adapter.stopAccount(account.accountId)
  })

  it('stops account and clears health snapshot', async () => {
    const client: WeixinProtocolClient = {
      getUpdates: vi.fn((options: WeixinProtocolRequestOptions & { getUpdatesBuf: string }) => {
        return new Promise<WeixinGetUpdatesResponse>((_, reject) => {
          options.signal?.addEventListener('abort', () => reject(createAbortError()), { once: true })
        })
      }),
      sendTextMessage: vi.fn(async () => undefined)
    }

    const adapter = new WeixinChannelAdapter({ client })
    const account = createAccount()
    await adapter.startAccount(account, createContext())
    expect(adapter.getHealth(account.accountId)?.status).toBe('running')
    await adapter.stopAccount(account.accountId)
    expect(adapter.getHealth(account.accountId)).toBeNull()
  })

  it('updates health on poll failures', async () => {
    let callCount = 0
    const client: WeixinProtocolClient = {
      getUpdates: vi.fn((options: WeixinProtocolRequestOptions & { getUpdatesBuf: string }) => {
        callCount += 1
        if (callCount === 1) {
          return Promise.reject(new Error('network failed'))
        }
        return new Promise<WeixinGetUpdatesResponse>((_, reject) => {
          options.signal?.addEventListener('abort', () => reject(createAbortError()), { once: true })
        })
      }),
      sendTextMessage: vi.fn(async () => undefined)
    }
    const adapter = new WeixinChannelAdapter({
      client,
      retryDelayMs: 5,
      backoffDelayMs: 20,
      maxConsecutiveFailures: 2
    })
    const account = createAccount()
    await adapter.startAccount(account, createContext())

    await waitFor(() => {
      const health = adapter.getHealth(account.accountId)
      return Boolean(health?.status === 'error' && health.lastError?.includes('network failed'))
    })
    const health = adapter.getHealth(account.accountId)
    expect(health?.status).toBe('error')
    expect(health?.lastError).toContain('network failed')
    expect(health?.pausedUntil).not.toBeNull()

    await adapter.stopAccount(account.accountId)
  })
})
