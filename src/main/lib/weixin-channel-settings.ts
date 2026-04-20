import type {
    StartWeixinQrLogin,
    WaitWeixinQrLogin,
    WeixinGatewayAccount,
    WeixinQrStartResult,
    WeixinQrWaitResult
} from '@shared/types';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { resolveDeepClawPath } from '../agent/utils';

const WEIXIN_ACCOUNTS_PATH = resolveDeepClawPath('weixin-gateway-accounts.json')
const FIXED_WEIXIN_LOGIN_BASE_URL = 'https://ilinkai.weixin.qq.com'
const DEFAULT_BOT_TYPE = '3'
const QR_LONG_POLL_TIMEOUT_MS = 35000
const ACTIVE_LOGIN_TTL_MS = 5 * 60_000

type WeixinQrStatus =
  | 'wait'
  | 'scaned'
  | 'confirmed'
  | 'expired'
  | 'scaned_but_redirect'

type ActiveQrLoginSession = {
  sessionKey: string
  qrcode: string
  qrCodeUrl: string
  startedAt: number
  currentBaseUrl: string
}

type WeixinGetQrResponse = {
  qrcode?: string
  qrcode_img_content?: string
}

type WeixinQrStatusResponse = {
  status?: WeixinQrStatus
  bot_token?: string
  ilink_bot_id?: string
  baseurl?: string
  ilink_user_id?: string
  redirect_host?: string
}

const activeLoginSessions = new Map<string, ActiveQrLoginSession>()

const ensureFile = async (filePath: string, initialContents: string): Promise<void> => {
  await fs.mkdir(dirname(filePath), { recursive: true })
  try {
    await fs.access(filePath)
  } catch {
    await fs.writeFile(filePath, initialContents, 'utf8')
  }
}

const ensureAccountFile = async (): Promise<void> => {
  await ensureFile(WEIXIN_ACCOUNTS_PATH, '[]\n')
}

const normalizeAccount = (account: WeixinGatewayAccount): WeixinGatewayAccount => ({
  accountId: account.accountId.trim(),
  baseUrl: account.baseUrl.trim(),
  token: account.token.trim(),
  routeTag: account.routeTag.trim(),
  channelVersion: account.channelVersion.trim(),
  enabled: account.enabled,
  connectedAt: account.connectedAt
})

const readAccounts = async (): Promise<WeixinGatewayAccount[]> => {
  await ensureAccountFile()
  const source = await fs.readFile(WEIXIN_ACCOUNTS_PATH, 'utf8')
  const parsed = JSON.parse(source) as unknown
  if (!Array.isArray(parsed)) {
    return []
  }
  const accounts = parsed
    .filter((item): item is WeixinGatewayAccount => {
      if (!item || typeof item !== 'object') {
        return false
      }
      const candidate = item as Partial<WeixinGatewayAccount>
      return (
        typeof candidate.accountId === 'string' &&
        typeof candidate.baseUrl === 'string' &&
        typeof candidate.token === 'string'
      )
    })
    .map((item) => {
      const candidate = item as Partial<WeixinGatewayAccount>
      return normalizeAccount({
        accountId: candidate.accountId ?? '',
        baseUrl: candidate.baseUrl ?? '',
        token: candidate.token ?? '',
        routeTag: candidate.routeTag ?? '',
        channelVersion: candidate.channelVersion ?? '',
        enabled: candidate.enabled !== false,
        connectedAt:
          typeof candidate.connectedAt === 'number' && Number.isFinite(candidate.connectedAt)
            ? candidate.connectedAt
            : Date.now()
      })
    })
    .filter((account) => Boolean(account.accountId) && Boolean(account.baseUrl) && Boolean(account.token))
  return accounts
}

const writeAccounts = async (accounts: WeixinGatewayAccount[]): Promise<void> => {
  await ensureAccountFile()
  const sorted = [...accounts].sort((a, b) => b.connectedAt - a.connectedAt)
  await fs.writeFile(WEIXIN_ACCOUNTS_PATH, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8')
}

const isSessionFresh = (session: ActiveQrLoginSession): boolean =>
  Date.now() - session.startedAt < ACTIVE_LOGIN_TTL_MS

const purgeExpiredSessions = (): void => {
  for (const [sessionKey, session] of activeLoginSessions) {
    if (!isSessionFresh(session)) {
      activeLoginSessions.delete(sessionKey)
    }
  }
}

const ensureTrailingSlash = (value: string): string => (value.endsWith('/') ? value : `${value}/`)

const withTimeoutFetch = async (params: {
  url: string
  timeoutMs: number
}): Promise<Response> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), params.timeoutMs)
  try {
    return await fetch(params.url, { method: 'GET', signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

const fetchQrCode = async (): Promise<WeixinGetQrResponse> => {
  const url = new URL(
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(DEFAULT_BOT_TYPE)}`,
    ensureTrailingSlash(FIXED_WEIXIN_LOGIN_BASE_URL)
  )
  const response = await withTimeoutFetch({ url: url.toString(), timeoutMs: QR_LONG_POLL_TIMEOUT_MS })
  const responseText = await response.text()
  if (!response.ok) {
    throw new Error(`failed to request weixin qr code: ${response.status} ${responseText}`)
  }
  return JSON.parse(responseText) as WeixinGetQrResponse
}

const pollQrStatus = async (baseUrl: string, qrcode: string): Promise<WeixinQrStatusResponse> => {
  const url = new URL(
    `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
    ensureTrailingSlash(baseUrl)
  )
  try {
    const response = await withTimeoutFetch({ url: url.toString(), timeoutMs: QR_LONG_POLL_TIMEOUT_MS })
    const responseText = await response.text()
    if (!response.ok) {
      return { status: 'wait' }
    }
    return JSON.parse(responseText) as WeixinQrStatusResponse
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { status: 'wait' }
    }
    return { status: 'wait' }
  }
}

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

export const listWeixinGatewayAccounts = async (): Promise<WeixinGatewayAccount[]> => readAccounts()

export const upsertWeixinGatewayAccount = async (
  account: WeixinGatewayAccount
): Promise<WeixinGatewayAccount[]> => {
  const normalized = normalizeAccount(account)
  if (!normalized.accountId) {
    throw new Error('Weixin accountId is required.')
  }
  if (!normalized.baseUrl) {
    throw new Error('Weixin baseUrl is required.')
  }
  if (!normalized.token) {
    throw new Error('Weixin token is required.')
  }
  const accounts = await readAccounts()
  const next = accounts.filter((item) => item.accountId !== normalized.accountId)
  next.push(normalized)
  await writeAccounts(next)
  return next
}

export const removeWeixinGatewayAccount = async (accountId: string): Promise<WeixinGatewayAccount[]> => {
  const normalizedAccountId = accountId.trim()
  const accounts = await readAccounts()
  const next = accounts.filter((account) => account.accountId !== normalizedAccountId)
  await writeAccounts(next)
  return next
}

export const startWeixinQrLogin: StartWeixinQrLogin = async (input) => {
  purgeExpiredSessions()
  const accountId = input?.accountId?.trim()
  const sessionKey = accountId || randomUUID()
  const existing = activeLoginSessions.get(sessionKey)
  if (!input?.force && existing && isSessionFresh(existing)) {
    return {
      sessionKey,
      qrCodeUrl: existing.qrCodeUrl,
      message: '二维码已就绪，请扫码确认。'
    } satisfies WeixinQrStartResult
  }

  const qrResponse = await fetchQrCode()
  if (!qrResponse.qrcode || !qrResponse.qrcode_img_content) {
    return {
      sessionKey,
      qrCodeUrl: null,
      message: '二维码生成失败，请重试。'
    } satisfies WeixinQrStartResult
  }

  activeLoginSessions.set(sessionKey, {
    sessionKey,
    qrcode: qrResponse.qrcode,
    qrCodeUrl: qrResponse.qrcode_img_content,
    startedAt: Date.now(),
    currentBaseUrl: FIXED_WEIXIN_LOGIN_BASE_URL
  })

  return {
    sessionKey,
    qrCodeUrl: qrResponse.qrcode_img_content,
    message: '请使用微信扫码并确认授权。'
  } satisfies WeixinQrStartResult
}

export const waitWeixinQrLogin: WaitWeixinQrLogin = async (input) => {
  const sessionKey = input.sessionKey.trim()
  const session = activeLoginSessions.get(sessionKey)
  if (!session || !isSessionFresh(session)) {
    activeLoginSessions.delete(sessionKey)
    return {
      connected: false,
      accountId: null,
      baseUrl: null,
      token: null,
      userId: null,
      message: '登录会话不存在或已过期，请重新生成二维码。'
    } satisfies WeixinQrWaitResult
  }

  const timeoutMs = Math.max(1000, input.timeoutMs ?? 45000)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const statusResponse = await pollQrStatus(session.currentBaseUrl, session.qrcode)
    if (statusResponse.status === 'scaned_but_redirect' && statusResponse.redirect_host) {
      session.currentBaseUrl = `https://${statusResponse.redirect_host}`
    }
    if (statusResponse.status === 'confirmed') {
      activeLoginSessions.delete(sessionKey)
      return {
        connected: true,
        accountId: statusResponse.ilink_bot_id ?? null,
        baseUrl: statusResponse.baseurl ?? session.currentBaseUrl,
        token: statusResponse.bot_token ?? null,
        userId: statusResponse.ilink_user_id ?? null,
        message: '微信连接成功。'
      } satisfies WeixinQrWaitResult
    }
    if (statusResponse.status === 'expired') {
      activeLoginSessions.delete(sessionKey)
      return {
        connected: false,
        accountId: null,
        baseUrl: null,
        token: null,
        userId: null,
        message: '二维码已过期，请重新生成。'
      } satisfies WeixinQrWaitResult
    }
    await sleep(1000)
  }

  return {
    connected: false,
    accountId: null,
    baseUrl: null,
    token: null,
    userId: null,
    message: '等待扫码超时，请继续等待或重新生成二维码。'
  } satisfies WeixinQrWaitResult
}
