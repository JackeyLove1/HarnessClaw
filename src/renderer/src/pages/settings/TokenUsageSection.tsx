import { LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ToolCallUsageRecord, ToolStatsRecord, UsageOverview, UsageRecord } from '@shared/types'

type UsageTab = 'token' | 'toolStats' | 'toolCalls'

const PAGE_SIZE = 10

const formatNumber = (value: number): string => value.toLocaleString()

const formatTimestamp = (value: number | null): string =>
  value == null
    ? '--'
    : new Date(value).toLocaleString('zh-CN', {
        hour12: false
      })

const usageKindLabel: Record<UsageRecord['kind'], string> = {
  chat_turn: '对话请求',
  title_gen: '标题生成',
  connection_test: '连接测试'
}

const toolStatusLabel: Record<ToolCallUsageRecord['status'], string> = {
  running: '运行中',
  success: '成功',
  error: '失败'
}

const toolPhaseLabel: Record<ToolCallUsageRecord['phase'], string> = {
  called: '已发起',
  completed: '已完成'
}

const loadUsagePayload = async () => {
  const [overview, usageRecords, toolRecords, toolStats] = await Promise.all([
    window.context.getUsageOverview(),
    window.context.listUsageRecords(200),
    window.context.listToolCallRecords(200),
    window.context.listToolStats(100)
  ])

  return {
    overview,
    usageRecords,
    toolRecords,
    toolStats
  }
}

export const TokenUsageSection = () => {
  const [usageTab, setUsageTab] = useState<UsageTab>('token')
  const [isUsageLoading, setIsUsageLoading] = useState(true)
  const [usageError, setUsageError] = useState('')
  const [usageOverview, setUsageOverview] = useState<UsageOverview | null>(null)
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([])
  const [toolRecords, setToolRecords] = useState<ToolCallUsageRecord[]>([])
  const [toolStats, setToolStats] = useState<ToolStatsRecord[]>([])
  const [tokenPage, setTokenPage] = useState(1)
  const [toolStatsPage, setToolStatsPage] = useState(1)
  const [toolPage, setToolPage] = useState(1)

  useEffect(() => {
    let isMounted = true

    const refresh = async () => {
      setIsUsageLoading(true)
      setUsageError('')

      try {
        const payload = await loadUsagePayload()
        if (!isMounted) return

        setUsageOverview(payload.overview)
        setUsageRecords(payload.usageRecords)
        setToolRecords(payload.toolRecords)
        setToolStats(payload.toolStats)
        setTokenPage(1)
        setToolStatsPage(1)
        setToolPage(1)
      } catch (error) {
        if (!isMounted) return
        setUsageError(error instanceof Error ? error.message : '读取用量数据失败，请稍后重试。')
      } finally {
        if (isMounted) {
          setIsUsageLoading(false)
        }
      }
    }

    void refresh()

    return () => {
      isMounted = false
    }
  }, [])

  const handleRefreshUsage = async () => {
    setIsUsageLoading(true)
    setUsageError('')

    try {
      const payload = await loadUsagePayload()
      setUsageOverview(payload.overview)
      setUsageRecords(payload.usageRecords)
      setToolRecords(payload.toolRecords)
      setToolStats(payload.toolStats)
      setTokenPage(1)
      setToolStatsPage(1)
      setToolPage(1)
    } catch (error) {
      setUsageError(error instanceof Error ? error.message : '读取用量数据失败，请稍后重试。')
    } finally {
      setIsUsageLoading(false)
    }
  }

  const tokenTotalPages = Math.max(1, Math.ceil(usageRecords.length / PAGE_SIZE))
  const toolStatsTotalPages = Math.max(1, Math.ceil(toolStats.length / PAGE_SIZE))
  const toolTotalPages = Math.max(1, Math.ceil(toolRecords.length / PAGE_SIZE))

  const safeTokenPage = Math.min(tokenPage, tokenTotalPages)
  const safeToolStatsPage = Math.min(toolStatsPage, toolStatsTotalPages)
  const safeToolPage = Math.min(toolPage, toolTotalPages)

  const pagedUsageRecords = usageRecords.slice(
    (safeTokenPage - 1) * PAGE_SIZE,
    safeTokenPage * PAGE_SIZE
  )
  const pagedToolStats = toolStats.slice(
    (safeToolStatsPage - 1) * PAGE_SIZE,
    safeToolStatsPage * PAGE_SIZE
  )
  const pagedToolRecords = toolRecords.slice(
    (safeToolPage - 1) * PAGE_SIZE,
    safeToolPage * PAGE_SIZE
  )

  return (
    <div className="rounded-3xl border border-[var(--border-soft)] bg-white px-8 py-7 shadow-[0_14px_38px_rgba(15,15,20,0.05)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[26px] font-semibold text-[var(--ink-main)]">用量统计</h2>
          <p className="mt-2 text-[14px] text-[var(--ink-faint)]">
            统计模型 Token 消耗、工具调用明细，以及按优先级排序的工具使用情况。
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefreshUsage}
          disabled={isUsageLoading}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border-soft)] bg-white px-4 text-[14px] font-medium text-[var(--ink-main)] transition-all hover:bg-[#f6f6fb] disabled:cursor-not-allowed disabled:bg-[#f4f4f7] disabled:text-[#9ca0ad]"
        >
          {isUsageLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          <span>{isUsageLoading ? '刷新中...' : '刷新数据'}</span>
        </button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-[var(--border-soft)] bg-[#fafafe] px-4 py-3">
          <p className="text-[13px] text-[var(--ink-faint)]">总会话数</p>
          <p className="mt-2 text-[34px] font-semibold leading-none text-[var(--ink-main)]">
            {usageOverview ? formatNumber(usageOverview.totalSessions) : '--'}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border-soft)] bg-[#fafafe] px-4 py-3">
          <p className="text-[13px] text-[var(--ink-faint)]">总消息数</p>
          <p className="mt-2 text-[34px] font-semibold leading-none text-[var(--ink-main)]">
            {usageOverview ? formatNumber(usageOverview.totalMessages) : '--'}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border-soft)] bg-[#fafafe] px-4 py-3">
          <p className="text-[13px] text-[var(--ink-faint)]">今日 Token</p>
          <p className="mt-2 text-[34px] font-semibold leading-none text-[var(--ink-main)]">
            {usageOverview ? formatNumber(usageOverview.todayTokenUsage) : '--'}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border-soft)] bg-[#fafafe] px-4 py-3">
          <p className="text-[13px] text-[var(--ink-faint)]">今日剩余 Token</p>
          <p className="mt-2 text-[34px] font-semibold leading-none text-[var(--ink-main)]">
            {usageOverview?.remainingTokens != null ? formatNumber(usageOverview.remainingTokens) : '--'}
          </p>
        </div>
      </div>

      {usageOverview ? (
        <div className="mt-4 rounded-xl border border-[var(--border-soft)] bg-[#fbfbfe] px-3 py-2 text-[13px] text-[var(--ink-faint)]">
          今日细分：输入 {formatNumber(usageOverview.todayInputTokens)} / 输出{' '}
          {formatNumber(usageOverview.todayOutputTokens)} / CacheCreate{' '}
          {formatNumber(usageOverview.todayCacheCreationTokens)} / CacheRead{' '}
          {formatNumber(usageOverview.todayCacheReadTokens)}
        </div>
      ) : null}

      {usageError ? (
        <div className="mt-4 rounded-xl border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-[13px] text-[#b91c1c]">
          {usageError}
        </div>
      ) : null}

      <div className="mt-6 inline-flex rounded-xl border border-[var(--border-soft)] bg-[#f6f6fb] p-1">
        <button
          type="button"
          onClick={() => setUsageTab('token')}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all ${
            usageTab === 'token'
              ? 'bg-white text-[var(--ink-main)] shadow-[0_2px_10px_rgba(15,15,20,0.08)]'
              : 'text-[var(--ink-faint)]'
          }`}
        >
          Token 明细
        </button>
        <button
          type="button"
          onClick={() => setUsageTab('toolStats')}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all ${
            usageTab === 'toolStats'
              ? 'bg-white text-[var(--ink-main)] shadow-[0_2px_10px_rgba(15,15,20,0.08)]'
              : 'text-[var(--ink-faint)]'
          }`}
        >
          工具聚合统计
        </button>
        <button
          type="button"
          onClick={() => setUsageTab('toolCalls')}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all ${
            usageTab === 'toolCalls'
              ? 'bg-white text-[var(--ink-main)] shadow-[0_2px_10px_rgba(15,15,20,0.08)]'
              : 'text-[var(--ink-faint)]'
          }`}
        >
          Tool/MCP 调用明细
        </button>
      </div>

      {usageTab === 'token' ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--border-soft)]">
          <table className="min-w-full border-collapse text-left text-[13px]">
            <thead className="bg-[#f8f8fc] text-[var(--ink-faint)]">
              <tr>
                <th className="px-3 py-2 font-medium">时间</th>
                <th className="px-3 py-2 font-medium">类型</th>
                <th className="px-3 py-2 font-medium">模型</th>
                <th className="px-3 py-2 font-medium">输入</th>
                <th className="px-3 py-2 font-medium">输出</th>
                <th className="px-3 py-2 font-medium">合计</th>
              </tr>
            </thead>
            <tbody>
              {usageRecords.length ? (
                pagedUsageRecords.map((record) => (
                  <tr
                    key={record.id}
                    className="border-t border-[var(--border-soft)] text-[var(--ink-main)]"
                  >
                    <td className="px-3 py-2">{formatTimestamp(record.timestamp)}</td>
                    <td className="px-3 py-2">{usageKindLabel[record.kind]}</td>
                    <td className="px-3 py-2">{record.model}</td>
                    <td className="px-3 py-2">{formatNumber(record.inputTokens)}</td>
                    <td className="px-3 py-2">{formatNumber(record.outputTokens)}</td>
                    <td className="px-3 py-2 font-medium">{formatNumber(record.totalTokens)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-7 text-center text-[var(--ink-faint)]" colSpan={6}>
                    暂无 Token 使用记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {usageRecords.length ? (
            <div className="flex items-center justify-between border-t border-[var(--border-soft)] bg-[#fcfcff] px-3 py-2 text-[12px] text-[var(--ink-faint)]">
              <span>
                第 {safeTokenPage}/{tokenTotalPages} 页 · 每页最多 {PAGE_SIZE} 条
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safeTokenPage <= 1}
                  onClick={() => setTokenPage((page) => Math.max(1, page - 1))}
                  className="rounded-lg border border-[var(--border-soft)] bg-white px-2 py-1 text-[12px] text-[var(--ink-main)] disabled:cursor-not-allowed disabled:text-[#9ca0ad]"
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={safeTokenPage >= tokenTotalPages}
                  onClick={() => setTokenPage((page) => Math.min(tokenTotalPages, page + 1))}
                  className="rounded-lg border border-[var(--border-soft)] bg-white px-2 py-1 text-[12px] text-[var(--ink-main)] disabled:cursor-not-allowed disabled:text-[#9ca0ad]"
                >
                  下一页
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {usageTab === 'toolStats' ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--border-soft)]">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-[13px]">
              <thead className="bg-[#f8f8fc] text-[var(--ink-faint)]">
                <tr>
                  <th className="px-3 py-2 font-medium">工具</th>
                  <th className="px-3 py-2 font-medium">类型</th>
                  <th className="px-3 py-2 font-medium">基础优先级</th>
                  <th className="px-3 py-2 font-medium">生效优先级</th>
                  <th className="px-3 py-2 font-medium">使用次数</th>
                  <th className="px-3 py-2 font-medium">成功/失败</th>
                  <th className="px-3 py-2 font-medium">总耗时</th>
                  <th className="px-3 py-2 font-medium">平均耗时</th>
                  <th className="px-3 py-2 font-medium">归因 Token</th>
                  <th className="px-3 py-2 font-medium">最近使用</th>
                </tr>
              </thead>
              <tbody>
                {toolStats.length ? (
                  pagedToolStats.map((record) => (
                    <tr
                      key={`${record.callType}:${record.toolName}`}
                      className="border-t border-[var(--border-soft)] text-[var(--ink-main)]"
                    >
                      <td className="px-3 py-2 font-medium">{record.toolName}</td>
                      <td className="px-3 py-2">{record.callType.toUpperCase()}</td>
                      <td className="px-3 py-2">{formatNumber(record.basePriority)}</td>
                      <td className="px-3 py-2">{formatNumber(record.effectivePriority)}</td>
                      <td className="px-3 py-2">{formatNumber(record.useCount)}</td>
                      <td className="px-3 py-2">
                        {formatNumber(record.successCount)} / {formatNumber(record.errorCount)}
                      </td>
                      <td className="px-3 py-2">{formatNumber(record.totalDurationMs)}ms</td>
                      <td className="px-3 py-2">{formatNumber(record.averageDurationMs)}ms</td>
                      <td className="px-3 py-2">
                        <div>{formatNumber(record.totalTokens)}</div>
                        <div className="text-[11px] text-[var(--ink-faint)]">
                          In {formatNumber(record.totalInputTokens)} / Out{' '}
                          {formatNumber(record.totalOutputTokens)}
                        </div>
                      </td>
                      <td className="px-3 py-2">{formatTimestamp(record.lastUsedAt)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-7 text-center text-[var(--ink-faint)]" colSpan={10}>
                      暂无工具统计记录
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {toolStats.length ? (
            <div className="flex items-center justify-between border-t border-[var(--border-soft)] bg-[#fcfcff] px-3 py-2 text-[12px] text-[var(--ink-faint)]">
              <span>
                第 {safeToolStatsPage}/{toolStatsTotalPages} 页 · 每页最多 {PAGE_SIZE} 条
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safeToolStatsPage <= 1}
                  onClick={() => setToolStatsPage((page) => Math.max(1, page - 1))}
                  className="rounded-lg border border-[var(--border-soft)] bg-white px-2 py-1 text-[12px] text-[var(--ink-main)] disabled:cursor-not-allowed disabled:text-[#9ca0ad]"
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={safeToolStatsPage >= toolStatsTotalPages}
                  onClick={() => setToolStatsPage((page) => Math.min(toolStatsTotalPages, page + 1))}
                  className="rounded-lg border border-[var(--border-soft)] bg-white px-2 py-1 text-[12px] text-[var(--ink-main)] disabled:cursor-not-allowed disabled:text-[#9ca0ad]"
                >
                  下一页
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {usageTab === 'toolCalls' ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--border-soft)]">
          <table className="min-w-full border-collapse text-left text-[13px]">
            <thead className="bg-[#f8f8fc] text-[var(--ink-faint)]">
              <tr>
                <th className="px-3 py-2 font-medium">时间</th>
                <th className="px-3 py-2 font-medium">调用类型</th>
                <th className="px-3 py-2 font-medium">工具名</th>
                <th className="px-3 py-2 font-medium">阶段</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">耗时</th>
              </tr>
            </thead>
            <tbody>
              {toolRecords.length ? (
                pagedToolRecords.map((record) => (
                  <tr
                    key={record.eventId}
                    className="border-t border-[var(--border-soft)] text-[var(--ink-main)]"
                  >
                    <td className="px-3 py-2">{formatTimestamp(record.timestamp)}</td>
                    <td className="px-3 py-2">{record.callType.toUpperCase()}</td>
                    <td className="px-3 py-2">{record.toolName}</td>
                    <td className="px-3 py-2">{toolPhaseLabel[record.phase]}</td>
                    <td className="px-3 py-2">{toolStatusLabel[record.status]}</td>
                    <td className="px-3 py-2">
                      {record.durationMs != null ? `${record.durationMs}ms` : '--'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="px-3 py-7 text-center text-[var(--ink-faint)]" colSpan={6}>
                    暂无 Tool/MCP 调用记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {toolRecords.length ? (
            <div className="flex items-center justify-between border-t border-[var(--border-soft)] bg-[#fcfcff] px-3 py-2 text-[12px] text-[var(--ink-faint)]">
              <span>
                第 {safeToolPage}/{toolTotalPages} 页 · 每页最多 {PAGE_SIZE} 条
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safeToolPage <= 1}
                  onClick={() => setToolPage((page) => Math.max(1, page - 1))}
                  className="rounded-lg border border-[var(--border-soft)] bg-white px-2 py-1 text-[12px] text-[var(--ink-main)] disabled:cursor-not-allowed disabled:text-[#9ca0ad]"
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={safeToolPage >= toolTotalPages}
                  onClick={() => setToolPage((page) => Math.min(toolTotalPages, page + 1))}
                  className="rounded-lg border border-[var(--border-soft)] bg-white px-2 py-1 text-[12px] text-[var(--ink-main)] disabled:cursor-not-allowed disabled:text-[#9ca0ad]"
                >
                  下一页
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
