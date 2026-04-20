import crypto from 'node:crypto'

export interface WeixinMessageItem {
  type?: number
  text_item?: {
    text?: string
  }
}

export interface WeixinMessage {
  message_id?: number
  from_user_id?: string
  to_user_id?: string
  group_id?: string
  message_type?: number
  item_list?: WeixinMessageItem[]
  context_token?: string
  create_time_ms?: number
}

export interface WeixinGetUpdatesResponse {
  ret?: number
  errcode?: number
  errmsg?: string
  msgs?: WeixinMessage[]
  get_updates_buf?: string
  longpolling_timeout_ms?: number
}

export type WeixinProtocolRequestOptions = {
  baseUrl: string
  token?: string
  routeTag?: string
  channelVersion?: string
  timeoutMs: number
  signal?: AbortSignal
}

export interface WeixinProtocolClient {
  getUpdates: (
    options: WeixinProtocolRequestOptions & { getUpdatesBuf: string }
  ) => Promise<WeixinGetUpdatesResponse>
  sendTextMessage: (
    options: WeixinProtocolRequestOptions & {
      toUserId: string
      text: string
      contextToken?: string
    }
  ) => Promise<void>
}

const DEFAULT_APP_ID = 'bot'
const DEFAULT_CLIENT_VERSION = '0'

const ensureTrailingSlash = (value: string): string =>
  value.endsWith('/') ? value : `${value}/`

const buildClientMessageId = (): string => crypto.randomUUID()

const buildWechatUinHeader = (): string => {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0)
  return Buffer.from(String(uint32), 'utf-8').toString('base64')
}

const buildHeaders = (options: {
  token?: string
  routeTag?: string
  channelVersion?: string
  bodyText: string
}): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'Content-Length': String(Buffer.byteLength(options.bodyText, 'utf-8')),
    'X-WECHAT-UIN': buildWechatUinHeader(),
    'iLink-App-Id': DEFAULT_APP_ID,
    'iLink-App-ClientVersion': options.channelVersion?.trim() || DEFAULT_CLIENT_VERSION
  }
  if (options.token?.trim()) {
    headers.Authorization = `Bearer ${options.token.trim()}`
  }
  if (options.routeTag?.trim()) {
    headers.SKRouteTag = options.routeTag.trim()
  }
  return headers
}

const buildAbortSignal = (
  signal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void } => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = (): void => controller.abort()
  if (signal) {
    signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout)
      if (signal) {
        signal.removeEventListener('abort', onAbort)
      }
    }
  }
}

const postJson = async <TResponse>(
  endpoint: string,
  payload: Record<string, unknown>,
  options: WeixinProtocolRequestOptions
): Promise<TResponse> => {
  const bodyText = JSON.stringify(payload)
  const url = new URL(endpoint, ensureTrailingSlash(options.baseUrl))
  const abort = buildAbortSignal(options.signal, options.timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders({
        token: options.token,
        routeTag: options.routeTag,
        channelVersion: options.channelVersion,
        bodyText
      }),
      body: bodyText,
      signal: abort.signal
    })
    const responseText = await response.text()
    if (!response.ok) {
      throw new Error(`weixin request failed (${response.status}): ${responseText}`)
    }
    if (!responseText.trim()) {
      return {} as TResponse
    }
    return JSON.parse(responseText) as TResponse
  } finally {
    abort.cleanup()
  }
}

export const createWeixinProtocolClient = (): WeixinProtocolClient => ({
  async getUpdates(options) {
    try {
      return await postJson<WeixinGetUpdatesResponse>(
        'ilink/bot/getupdates',
        { get_updates_buf: options.getUpdatesBuf },
        options
      )
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          ret: 0,
          msgs: [],
          get_updates_buf: options.getUpdatesBuf
        }
      }
      throw error
    }
  },
  async sendTextMessage(options) {
    await postJson<unknown>(
      'ilink/bot/sendmessage',
      {
        msg: {
          from_user_id: '',
          to_user_id: options.toUserId,
          client_id: buildClientMessageId(),
          message_type: 2,
          message_state: 2,
          context_token: options.contextToken,
          item_list: [
            {
              type: 1,
              text_item: { text: options.text }
            }
          ]
        }
      },
      options
    )
  }
})
