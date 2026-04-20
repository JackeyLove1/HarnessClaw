import { Button } from '@/components/ui';
import type { WeixinGatewayAccount } from '@shared/types';
import { LoaderCircle, PlugZap, QrCode, RefreshCw, Unplug } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

type WeixinHealth = Awaited<ReturnType<typeof window.context.getWeixinGatewayHealth>>[number]

const HEALTH_STYLE: Record<WeixinHealth['status'], string> = {
  idle: 'bg-[#f3f3f6] text-[#6b6b7a]',
  running: 'bg-[#eef8ef] text-[#2f7d46]',
  paused: 'bg-[#f4f2ec] text-[#7d6740]',
  error: 'bg-[#fff1f2] text-[#b42318]',
  stopped: 'bg-[#f3f3f6] text-[#6b6b7a]'
}

const formatTime = (timestamp: number | null): string => {
  if (!timestamp) {
    return '未记录'
  }
  return new Intl.DateTimeFormat(window.context.locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp))
}

export const ChannelsPage = () => {
  const [accounts, setAccounts] = useState<WeixinGatewayAccount[]>([])
  const [health, setHealth] = useState<WeixinHealth[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isStartingQr, setIsStartingQr] = useState(false)
  const [isWaitingQr, setIsWaitingQr] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [sessionKey, setSessionKey] = useState<string | null>(null)
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null)

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.accountId === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  )

  const healthMap = useMemo(() => {
    return new Map(health.map((item) => [item.accountId, item]))
  }, [health])

  const loadData = async (silent = false): Promise<void> => {
    if (!silent) {
      setIsLoading(true)
    }
    setIsRefreshing(silent)
    try {
      const [nextAccounts, nextHealth] = await Promise.all([
        window.context.listWeixinGatewayAccounts(),
        window.context.getWeixinGatewayHealth()
      ])
      setAccounts(nextAccounts)
      setHealth(nextHealth)
      setSelectedAccountId((current) => {
        if (current && nextAccounts.some((item) => item.accountId === current)) {
          return current
        }
        return nextAccounts[0]?.accountId ?? null
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '加载微信渠道配置失败。')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    if (!sessionKey || isWaitingQr) {
      return
    }

    const timer = window.setInterval(() => {
      void handleWaitQr(5000, true)
    }, 6000)
    return () => {
      window.clearInterval(timer)
    }
  }, [sessionKey, isWaitingQr])

  const handleStartQr = async () => {
    setIsStartingQr(true)
    setErrorMessage('')
    setStatusMessage('')
    try {
      const result = await window.context.startWeixinQrLogin({
        accountId: selectedAccountId ?? undefined,
        force: true
      })
      setSessionKey(result.sessionKey)
      setQrCodeUrl(result.qrCodeUrl)
      setStatusMessage(result.message)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '生成二维码失败。')
    } finally {
      setIsStartingQr(false)
    }
  }

  const handleWaitQr = async (timeoutMs = 45000, silent = false) => {
    if (!sessionKey) {
      setErrorMessage('请先生成二维码。')
      return
    }

    setIsWaitingQr(true)
    if (!silent) {
      setErrorMessage('')
      setStatusMessage('')
    }
    try {
      const result = await window.context.waitWeixinQrLogin({ sessionKey, timeoutMs })
      if (result.connected) {
        setStatusMessage(result.message)
        setSessionKey(null)
        setQrCodeUrl(null)
        await loadData(true)
        return
      }
      if (!silent) {
        setStatusMessage(result.message)
      }
    } catch (error) {
      if (!silent) {
        setErrorMessage(error instanceof Error ? error.message : '等待扫码确认失败。')
      }
    } finally {
      setIsWaitingQr(false)
    }
  }

  const handleDisconnect = async (accountId: string) => {
    const confirmed = window.confirm(`确定断开微信账号 ${accountId} 吗？`)
    if (!confirmed) {
      return
    }
    setErrorMessage('')
    setStatusMessage('')
    try {
      await window.context.disconnectWeixinGatewayAccount(accountId)
      setStatusMessage(`已断开账号：${accountId}`)
      await loadData(true)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '断开账号失败。')
    }
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--content-bg)]">
      <aside className="flex w-[332px] min-w-[332px] flex-col border-r border-[var(--border-soft)] px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[24px] font-semibold text-[var(--ink-main)]">渠道</p>
            <p className="mt-2 text-[13px] leading-6 text-[var(--ink-faint)]">
              管理微信渠道账号连接状态，支持扫码接入与断开。
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void loadData(true)}
            disabled={isLoading || isRefreshing}
            className="h-10 w-10 rounded-2xl border-[var(--border-soft)] bg-white"
          >
            {isRefreshing ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="mt-5 rounded-3xl border border-[var(--border-soft)] bg-white p-3 shadow-[0_10px_30px_rgba(15,15,20,0.05)]">
          <div className="max-h-[calc(100vh-250px)] space-y-2 overflow-auto pr-1">
            {accounts.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border-soft)] bg-[#fafafc] px-4 py-6 text-[13px] leading-6 text-[var(--ink-faint)]">
                暂无已连接微信账号。右侧点击“生成二维码”开始连接。
              </div>
            ) : (
              accounts.map((account) => {
                const isSelected = account.accountId === selectedAccountId
                const itemHealth = healthMap.get(account.accountId)
                return (
                  <button
                    key={account.accountId}
                    type="button"
                    onClick={() => setSelectedAccountId(account.accountId)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition-all ${
                      isSelected
                        ? 'border-[#d8d8e3] bg-[#f6f6fb] shadow-[0_10px_20px_rgba(15,15,20,0.04)]'
                        : 'border-transparent bg-[#fbfbfe] hover:bg-[#f5f5fa]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold text-[var(--ink-main)]">
                          {account.accountId}
                        </p>
                        <p className="mt-1 truncate text-[12px] text-[var(--ink-faint)]">
                          {account.baseUrl}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ${
                          itemHealth ? HEALTH_STYLE[itemHealth.status] : HEALTH_STYLE.idle
                        }`}
                      >
                        {itemHealth?.status ?? 'idle'}
                      </span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 justify-center overflow-auto px-8 py-8">
        <div className="w-full max-w-[980px] space-y-6">
          <div className="rounded-3xl border border-[var(--border-soft)] bg-white px-8 py-7 shadow-[0_14px_38px_rgba(15,15,20,0.05)]">
            <h1 className="text-[28px] font-semibold text-[var(--ink-main)]">微信扫码连接</h1>
            <p className="mt-2 text-[14px] text-[var(--ink-faint)]">
              生成二维码后，使用微信扫码并确认授权。系统会自动保存账号并启动网关连接。
            </p>

            {errorMessage ? (
              <div className="mt-5 rounded-2xl border border-[#fecaca] bg-[#fff1f2] px-4 py-3 text-[13px] text-[#b42318]">
                {errorMessage}
              </div>
            ) : null}

            {statusMessage ? (
              <div className="mt-5 rounded-2xl border border-[#d7e7d8] bg-[#f3faf4] px-4 py-3 text-[13px] text-[#2f7d46]">
                {statusMessage}
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={() => void handleStartQr()}
                disabled={isStartingQr || isWaitingQr}
                className="rounded-2xl bg-[var(--ink-main)] text-white hover:bg-[#2c2c34]"
              >
                {isStartingQr ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <QrCode className="mr-2 h-4 w-4" />
                )}
                生成二维码
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleWaitQr()}
                disabled={!sessionKey || isStartingQr || isWaitingQr}
                className="rounded-2xl border-[var(--border-soft)]"
              >
                {isWaitingQr ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PlugZap className="mr-2 h-4 w-4" />
                )}
                等待确认
              </Button>
            </div>

            <div className="mt-6 rounded-3xl border border-[var(--border-soft)] bg-[#fbfbfe] p-6">
              {qrCodeUrl ? (
                <div className="space-y-3">
                  <img
                    src={qrCodeUrl}
                    alt="微信扫码二维码"
                    className="h-[260px] w-[260px] rounded-2xl border border-[var(--border-soft)] bg-white object-contain p-3"
                  />
                  <p className="text-[12px] text-[var(--ink-faint)]">
                    会话 ID: {sessionKey}（页面会自动短轮询登录状态）
                  </p>
                </div>
              ) : (
                <div className="flex h-[260px] w-[260px] items-center justify-center rounded-2xl border border-dashed border-[var(--border-soft)] bg-white text-[13px] text-[var(--ink-faint)]">
                  暂无二维码
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-[var(--border-soft)] bg-white px-8 py-7 shadow-[0_14px_38px_rgba(15,15,20,0.05)]">
            <h2 className="text-[22px] font-semibold text-[var(--ink-main)]">账号详情</h2>
            {!selectedAccount ? (
              <p className="mt-3 text-[13px] text-[var(--ink-faint)]">请选择左侧账号查看详情。</p>
            ) : (
              <div className="mt-5 space-y-3 text-[13px] text-[var(--ink-soft)]">
                <p>账号 ID: {selectedAccount.accountId}</p>
                <p>Base URL: {selectedAccount.baseUrl}</p>
                <p>Route Tag: {selectedAccount.routeTag || '未设置'}</p>
                <p>Channel Version: {selectedAccount.channelVersion || '未设置'}</p>
                <p>Connected At: {formatTime(selectedAccount.connectedAt)}</p>
                <p>Last Event: {formatTime(healthMap.get(selectedAccount.accountId)?.lastEventAt ?? null)}</p>
                <p>
                  Last Error: {healthMap.get(selectedAccount.accountId)?.lastError || '无'}
                </p>
                <div className="pt-2">
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => void handleDisconnect(selectedAccount.accountId)}
                    className="rounded-2xl"
                  >
                    <Unplug className="mr-2 h-4 w-4" />
                    断开连接
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
