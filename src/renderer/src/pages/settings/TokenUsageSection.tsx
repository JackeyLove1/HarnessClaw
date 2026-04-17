import { LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  SkillUsageRecord,
  ToolCallUsageRecord,
  ToolStatsRecord,
  UsageOverview,
  UsageRecord
} from '@shared/types'

type UsageTab = 'token' | 'toolStats' | 'toolCalls' | 'skillStats' | 'skills'

type UsagePayload = {
  overview: UsageOverview
  usageRecords: UsageRecord[]
  toolRecords: ToolCallUsageRecord[]
  toolStats: ToolStatsRecord[]
  skillRecords: SkillUsageRecord[]
}

type SkillStatsRow = {
  skillId: string
  skillName: string
  useCount: number
  sessionCount: number
  lastUsedAt: number
  latestSessionTitle: string
}

const PAGE_SIZE = 10

const formatNumber = (value: number): string => value.toLocaleString()

const formatTimestamp = (value: number | null): string =>
  value == null
    ? '--'
    : new Date(value).toLocaleString('zh-CN', {
        hour12: false
      })

const usageKindLabel: Record<UsageRecord['kind'], string> = {
  chat_turn: 'Chat Turn',
  title_gen: 'Title Generation',
  connection_test: 'Connection Test'
}

const toolStatusLabel: Record<ToolCallUsageRecord['status'], string> = {
  running: 'Running',
  success: 'Success',
  error: 'Error'
}

const toolPhaseLabel: Record<ToolCallUsageRecord['phase'], string> = {
  called: 'Called',
  completed: 'Completed'
}

const loadUsagePayload = async (): Promise<UsagePayload> => {
  const [overview, usageRecords, toolRecords, toolStats, skillRecords] = await Promise.all([
    window.context.getUsageOverview(),
    window.context.listUsageRecords(200),
    window.context.listToolCallRecords(200),
    window.context.listToolStats(100),
    window.context.listSkillUsageRecords(200)
  ])

  return {
    overview,
    usageRecords,
    toolRecords,
    toolStats,
    skillRecords
  }
}

const paginate = <T,>(items: T[], page: number): T[] =>
  items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

const buildSkillStats = (records: SkillUsageRecord[]): SkillStatsRow[] => {
  const statsBySkillId = new Map<
    string,
    {
      skillId: string
      skillName: string
      useCount: number
      sessionIds: Set<string>
      lastUsedAt: number
      latestSessionTitle: string
    }
  >()

  for (const record of records) {
    const existing = statsBySkillId.get(record.skillId)
    if (!existing) {
      statsBySkillId.set(record.skillId, {
        skillId: record.skillId,
        skillName: record.skillName,
        useCount: 1,
        sessionIds: new Set(record.sessionId ? [record.sessionId] : []),
        lastUsedAt: record.timestamp,
        latestSessionTitle: record.sessionTitle || 'Untitled session'
      })
      continue
    }

    existing.useCount += 1
    if (record.sessionId) {
      existing.sessionIds.add(record.sessionId)
    }
    if (record.timestamp >= existing.lastUsedAt) {
      existing.lastUsedAt = record.timestamp
      existing.latestSessionTitle = record.sessionTitle || 'Untitled session'
    }
  }

  return [...statsBySkillId.values()]
    .map((entry) => ({
      skillId: entry.skillId,
      skillName: entry.skillName,
      useCount: entry.useCount,
      sessionCount: entry.sessionIds.size,
      lastUsedAt: entry.lastUsedAt,
      latestSessionTitle: entry.latestSessionTitle
    }))
    .sort((left, right) => {
      if (right.useCount !== left.useCount) {
        return right.useCount - left.useCount
      }
      return right.lastUsedAt - left.lastUsedAt
    })
}

const Pager = ({
  currentPage,
  totalPages,
  onPrevious,
  onNext
}: {
  currentPage: number
  totalPages: number
  onPrevious: () => void
  onNext: () => void
}) => (
  <div className="flex items-center justify-between border-t border-[var(--border-soft)] bg-[#fcfcff] px-3 py-2 text-[12px] text-[var(--ink-faint)]">
    <span>
      Page {currentPage}/{totalPages} · {PAGE_SIZE} rows
    </span>
    <div className="flex items-center gap-2">
      <button
        type="button"
        disabled={currentPage <= 1}
        onClick={onPrevious}
        className="rounded-lg border border-[var(--border-soft)] bg-white px-2 py-1 text-[12px] text-[var(--ink-main)] disabled:cursor-not-allowed disabled:text-[#9ca0ad]"
      >
        Previous
      </button>
      <button
        type="button"
        disabled={currentPage >= totalPages}
        onClick={onNext}
        className="rounded-lg border border-[var(--border-soft)] bg-white px-2 py-1 text-[12px] text-[var(--ink-main)] disabled:cursor-not-allowed disabled:text-[#9ca0ad]"
      >
        Next
      </button>
    </div>
  </div>
)

export const TokenUsageSection = () => {
  const [usageTab, setUsageTab] = useState<UsageTab>('token')
  const [isUsageLoading, setIsUsageLoading] = useState(true)
  const [usageError, setUsageError] = useState('')
  const [usageOverview, setUsageOverview] = useState<UsageOverview | null>(null)
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([])
  const [toolRecords, setToolRecords] = useState<ToolCallUsageRecord[]>([])
  const [toolStats, setToolStats] = useState<ToolStatsRecord[]>([])
  const [skillRecords, setSkillRecords] = useState<SkillUsageRecord[]>([])
  const [tokenPage, setTokenPage] = useState(1)
  const [toolStatsPage, setToolStatsPage] = useState(1)
  const [toolPage, setToolPage] = useState(1)
  const [skillStatsPage, setSkillStatsPage] = useState(1)
  const [skillPage, setSkillPage] = useState(1)

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
        setSkillRecords(payload.skillRecords)
        setTokenPage(1)
        setToolStatsPage(1)
        setToolPage(1)
        setSkillStatsPage(1)
        setSkillPage(1)
      } catch (error) {
        if (!isMounted) return
        setUsageError(error instanceof Error ? error.message : 'Failed to load usage data.')
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
      setSkillRecords(payload.skillRecords)
      setTokenPage(1)
      setToolStatsPage(1)
      setToolPage(1)
      setSkillStatsPage(1)
      setSkillPage(1)
    } catch (error) {
      setUsageError(error instanceof Error ? error.message : 'Failed to load usage data.')
    } finally {
      setIsUsageLoading(false)
    }
  }

  const skillStats = buildSkillStats(skillRecords)
  const tokenTotalPages = Math.max(1, Math.ceil(usageRecords.length / PAGE_SIZE))
  const toolStatsTotalPages = Math.max(1, Math.ceil(toolStats.length / PAGE_SIZE))
  const toolTotalPages = Math.max(1, Math.ceil(toolRecords.length / PAGE_SIZE))
  const skillStatsTotalPages = Math.max(1, Math.ceil(skillStats.length / PAGE_SIZE))
  const skillTotalPages = Math.max(1, Math.ceil(skillRecords.length / PAGE_SIZE))

  const safeTokenPage = Math.min(tokenPage, tokenTotalPages)
  const safeToolStatsPage = Math.min(toolStatsPage, toolStatsTotalPages)
  const safeToolPage = Math.min(toolPage, toolTotalPages)
  const safeSkillStatsPage = Math.min(skillStatsPage, skillStatsTotalPages)
  const safeSkillPage = Math.min(skillPage, skillTotalPages)

  const pagedUsageRecords = paginate(usageRecords, safeTokenPage)
  const pagedToolStats = paginate(toolStats, safeToolStatsPage)
  const pagedToolRecords = paginate(toolRecords, safeToolPage)
  const pagedSkillStats = paginate(skillStats, safeSkillStatsPage)
  const pagedSkillRecords = paginate(skillRecords, safeSkillPage)

  return (
    <div className="rounded-3xl border border-[var(--border-soft)] bg-white px-8 py-7 shadow-[0_14px_38px_rgba(15,15,20,0.05)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[26px] font-semibold text-[var(--ink-main)]">Usage Analytics</h2>
          <p className="mt-2 text-[14px] text-[var(--ink-faint)]">
            Inspect token consumption, tool activity, and skill usage records from the local
            SQLite store.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefreshUsage}
          disabled={isUsageLoading}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--border-soft)] bg-white px-4 text-[14px] font-medium text-[var(--ink-main)] transition-all hover:bg-[#f6f6fb] disabled:cursor-not-allowed disabled:bg-[#f4f4f7] disabled:text-[#9ca0ad]"
        >
          {isUsageLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          <span>{isUsageLoading ? 'Refreshing...' : 'Refresh Data'}</span>
        </button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-[var(--border-soft)] bg-[#fafafe] px-4 py-3">
          <p className="text-[13px] text-[var(--ink-faint)]">Sessions</p>
          <p className="mt-2 text-[34px] font-semibold leading-none text-[var(--ink-main)]">
            {usageOverview ? formatNumber(usageOverview.totalSessions) : '--'}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border-soft)] bg-[#fafafe] px-4 py-3">
          <p className="text-[13px] text-[var(--ink-faint)]">Messages</p>
          <p className="mt-2 text-[34px] font-semibold leading-none text-[var(--ink-main)]">
            {usageOverview ? formatNumber(usageOverview.totalMessages) : '--'}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border-soft)] bg-[#fafafe] px-4 py-3">
          <p className="text-[13px] text-[var(--ink-faint)]">Today Tokens</p>
          <p className="mt-2 text-[34px] font-semibold leading-none text-[var(--ink-main)]">
            {usageOverview ? formatNumber(usageOverview.todayTokenUsage) : '--'}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border-soft)] bg-[#fafafe] px-4 py-3">
          <p className="text-[13px] text-[var(--ink-faint)]">Skill Records</p>
          <p className="mt-2 text-[34px] font-semibold leading-none text-[var(--ink-main)]">
            {formatNumber(skillRecords.length)}
          </p>
        </div>
      </div>

      {usageOverview ? (
        <div className="mt-4 rounded-xl border border-[var(--border-soft)] bg-[#fbfbfe] px-3 py-2 text-[13px] text-[var(--ink-faint)]">
          Today: input {formatNumber(usageOverview.todayInputTokens)} / output{' '}
          {formatNumber(usageOverview.todayOutputTokens)} / cache create{' '}
          {formatNumber(usageOverview.todayCacheCreationTokens)} / cache read{' '}
          {formatNumber(usageOverview.todayCacheReadTokens)}
        </div>
      ) : null}

      {usageError ? (
        <div className="mt-4 rounded-xl border border-[#fecaca] bg-[#fff1f2] px-3 py-2 text-[13px] text-[#b91c1c]">
          {usageError}
        </div>
      ) : null}

      <div className="mt-6 inline-flex flex-wrap rounded-xl border border-[var(--border-soft)] bg-[#f6f6fb] p-1">
        <button
          type="button"
          onClick={() => setUsageTab('token')}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all ${
            usageTab === 'token'
              ? 'bg-white text-[var(--ink-main)] shadow-[0_2px_10px_rgba(15,15,20,0.08)]'
              : 'text-[var(--ink-faint)]'
          }`}
        >
          Token Records
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
          Tool Stats
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
          Tool Calls
        </button>
        <button
          type="button"
          onClick={() => setUsageTab('skillStats')}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all ${
            usageTab === 'skillStats'
              ? 'bg-white text-[var(--ink-main)] shadow-[0_2px_10px_rgba(15,15,20,0.08)]'
              : 'text-[var(--ink-faint)]'
          }`}
        >
          Skill Stats
        </button>
        <button
          type="button"
          onClick={() => setUsageTab('skills')}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all ${
            usageTab === 'skills'
              ? 'bg-white text-[var(--ink-main)] shadow-[0_2px_10px_rgba(15,15,20,0.08)]'
              : 'text-[var(--ink-faint)]'
          }`}
        >
          Skill Usage
        </button>
      </div>

      {usageTab === 'token' ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--border-soft)]">
          <table className="min-w-full border-collapse text-left text-[13px]">
            <thead className="bg-[#f8f8fc] text-[var(--ink-faint)]">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">Input</th>
                <th className="px-3 py-2 font-medium">Output</th>
                <th className="px-3 py-2 font-medium">Total</th>
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
                    No token usage records yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {usageRecords.length ? (
            <Pager
              currentPage={safeTokenPage}
              totalPages={tokenTotalPages}
              onPrevious={() => setTokenPage((page) => Math.max(1, page - 1))}
              onNext={() => setTokenPage((page) => Math.min(tokenTotalPages, page + 1))}
            />
          ) : null}
        </div>
      ) : null}

      {usageTab === 'toolStats' ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--border-soft)]">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-[13px]">
              <thead className="bg-[#f8f8fc] text-[var(--ink-faint)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Tool</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Base Priority</th>
                  <th className="px-3 py-2 font-medium">Effective Priority</th>
                  <th className="px-3 py-2 font-medium">Calls</th>
                  <th className="px-3 py-2 font-medium">Success / Error</th>
                  <th className="px-3 py-2 font-medium">Total Duration</th>
                  <th className="px-3 py-2 font-medium">Avg Duration</th>
                  <th className="px-3 py-2 font-medium">Attributed Tokens</th>
                  <th className="px-3 py-2 font-medium">Last Used</th>
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
                      No tool statistics yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {toolStats.length ? (
            <Pager
              currentPage={safeToolStatsPage}
              totalPages={toolStatsTotalPages}
              onPrevious={() => setToolStatsPage((page) => Math.max(1, page - 1))}
              onNext={() => setToolStatsPage((page) => Math.min(toolStatsTotalPages, page + 1))}
            />
          ) : null}
        </div>
      ) : null}

      {usageTab === 'toolCalls' ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--border-soft)]">
          <table className="min-w-full border-collapse text-left text-[13px]">
            <thead className="bg-[#f8f8fc] text-[var(--ink-faint)]">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Tool</th>
                <th className="px-3 py-2 font-medium">Phase</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Duration</th>
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
                    No tool call records yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {toolRecords.length ? (
            <Pager
              currentPage={safeToolPage}
              totalPages={toolTotalPages}
              onPrevious={() => setToolPage((page) => Math.max(1, page - 1))}
              onNext={() => setToolPage((page) => Math.min(toolTotalPages, page + 1))}
            />
          ) : null}
        </div>
      ) : null}

      {usageTab === 'skillStats' ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--border-soft)]">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-[13px]">
              <thead className="bg-[#f8f8fc] text-[var(--ink-faint)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Skill</th>
                  <th className="px-3 py-2 font-medium">Skill ID</th>
                  <th className="px-3 py-2 font-medium">Uses</th>
                  <th className="px-3 py-2 font-medium">Sessions</th>
                  <th className="px-3 py-2 font-medium">Last Used</th>
                  <th className="px-3 py-2 font-medium">Latest Session</th>
                </tr>
              </thead>
              <tbody>
                {skillStats.length ? (
                  pagedSkillStats.map((record) => (
                    <tr
                      key={record.skillId}
                      className="border-t border-[var(--border-soft)] text-[var(--ink-main)]"
                    >
                      <td className="px-3 py-2 font-medium">{record.skillName}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-[var(--ink-faint)]">
                        {record.skillId}
                      </td>
                      <td className="px-3 py-2">{formatNumber(record.useCount)}</td>
                      <td className="px-3 py-2">{formatNumber(record.sessionCount)}</td>
                      <td className="px-3 py-2">{formatTimestamp(record.lastUsedAt)}</td>
                      <td className="px-3 py-2">{record.latestSessionTitle}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-7 text-center text-[var(--ink-faint)]" colSpan={6}>
                      No skill statistics yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {skillStats.length ? (
            <Pager
              currentPage={safeSkillStatsPage}
              totalPages={skillStatsTotalPages}
              onPrevious={() => setSkillStatsPage((page) => Math.max(1, page - 1))}
              onNext={() => setSkillStatsPage((page) =>
                Math.min(skillStatsTotalPages, page + 1)
              )}
            />
          ) : null}
        </div>
      ) : null}

      {usageTab === 'skills' ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--border-soft)]">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-[13px]">
              <thead className="bg-[#f8f8fc] text-[var(--ink-faint)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Skill</th>
                  <th className="px-3 py-2 font-medium">Session</th>
                  <th className="px-3 py-2 font-medium">Round</th>
                  <th className="px-3 py-2 font-medium">Skill File</th>
                </tr>
              </thead>
              <tbody>
                {skillRecords.length ? (
                  pagedSkillRecords.map((record) => (
                    <tr
                      key={record.id}
                      className="border-t border-[var(--border-soft)] align-top text-[var(--ink-main)]"
                    >
                      <td className="px-3 py-2">{formatTimestamp(record.timestamp)}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{record.skillName}</div>
                        <div className="text-[11px] text-[var(--ink-faint)]">{record.skillId}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div>{record.sessionTitle || 'Untitled session'}</div>
                        <div className="text-[11px] text-[var(--ink-faint)]">
                          {record.sessionId || '--'}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div>Round {record.requestRound}</div>
                        <div className="text-[11px] text-[var(--ink-faint)]">
                          {record.assistantMessageId}
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] leading-5 text-[var(--ink-faint)]">
                        {record.skillFilePath}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-7 text-center text-[var(--ink-faint)]" colSpan={5}>
                      No skill usage records yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {skillRecords.length ? (
            <Pager
              currentPage={safeSkillPage}
              totalPages={skillTotalPages}
              onPrevious={() => setSkillPage((page) => Math.max(1, page - 1))}
              onNext={() => setSkillPage((page) => Math.min(skillTotalPages, page + 1))}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
