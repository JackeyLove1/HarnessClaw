import type { SessionMeta } from '@shared/models'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  chatViewReducer,
  createInitialChatViewState,
  selectVisibleSessions,
  type AssistantTranscriptEntry,
  type SystemTranscriptEntry,
  type ToolGroupView,
  type TranscriptEntry,
  type UserTranscriptEntry
} from '../chat/reducer'

const CAPABILITY_ITEMS = [
  {
    icon: 'brief',
    title: '我能做什么?',
    description: '追踪 GDP、利率、CPI 等关键宏观经济数据，也能继续承接你的日常研究与分析任务。'
  },
  {
    icon: 'spark',
    title: '我是怎么做?',
    description: '支持长对话、多步推理、工具调用与结果整合，适合整理材料、生成方案和跟进执行。'
  }
]

const SCENARIO_ITEMS = [
  { icon: '📊', text: '想了解当前经济处于什么周期阶段' },
  { icon: '💹', text: '想知道利率变化会如何影响资产配置' },
  { icon: '📋', text: '想把一组公开数据整理成结构化结论' }
]

const QUICK_PROMPTS = ['最新的 GDP 增速和 CPI 数据是多少?', '目前加息周期到哪个阶段了?']
const INPUT_CHIPS = ['默认大模型', '技能', '找灵感']

const formatClockTime = (timestamp: number): string =>
  new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(timestamp)

const formatSessionTime = (timestamp: number): string => {
  const diff = Date.now() - timestamp
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`

  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(timestamp)
}

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
)

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </svg>
)

const ChatIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M7 18 3 21V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7Z" />
    <path d="M8 10h8" />
    <path d="M8 14h5" />
  </svg>
)

const SparkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
  </svg>
)

const CompassIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <circle cx="12" cy="12" r="8" />
    <path d="m15.5 8.5-2.2 6.1-6.1 2.2 2.2-6.1 6.1-2.2Z" />
  </svg>
)

const BoltIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
  </svg>
)

const BriefIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" />
    <path d="M4 9.5A1.5 1.5 0 0 1 5.5 8h13A1.5 1.5 0 0 1 20 9.5v8A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-8Z" />
    <path d="M4 12h16" />
  </svg>
)

const WrenchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="m14 7 3-3a4 4 0 0 1-5 5l-6.5 6.5a2 2 0 1 1-2.8-2.8L9.2 6.2a4 4 0 0 1 5-5l-3 3 2.8 2.8Z" />
  </svg>
)

const SendIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M21 3 10 14" />
    <path d="m21 3-7 18-4-7-7-4 18-7Z" />
  </svg>
)

const LinkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M10.8 13.2a4 4 0 0 1 0-5.7l2-2a4 4 0 1 1 5.7 5.7l-1.3 1.3" />
    <path d="M13.2 10.8a4 4 0 0 1 0 5.7l-2 2a4 4 0 0 1-5.7-5.7l1.3-1.3" />
  </svg>
)

const ChevronDownIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
    <path d="m6 9 6 6 6-6" />
  </svg>
)

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
    <rect x="6.5" y="6.5" width="11" height="11" rx="2.2" />
  </svg>
)

const ChevronIcon = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${className}`}>
    <path d="m9 6 6 6-6 6" />
  </svg>
)

const ToolGroupPanel = ({ toolGroup }: { toolGroup: ToolGroupView }) => (
  <details className="group rounded-2xl border border-[var(--border-soft)] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-left">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#f5f5f7] text-[var(--ink-subtle)]">
          <WrenchIcon />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-[var(--ink-main)]">{toolGroup.summary}</div>
          <div className="text-[11px] text-[var(--ink-faint)]">
            {toolGroup.calls.length} 次调用
            {toolGroup.totalDurationMs > 0 ? ` · ${toolGroup.totalDurationMs}ms` : ''}
          </div>
        </div>
      </div>
      <ChevronIcon className="text-[var(--ink-faint)] transition-transform duration-200 group-open:rotate-90" />
    </summary>
    <div className="border-t border-[var(--border-soft)] px-4 py-2">
      {toolGroup.calls.map((call) => (
        <div key={call.id} className="border-b border-[var(--border-soft)] py-3 last:border-b-0">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[12px] text-[var(--ink-main)]">{call.name}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                call.status === 'error'
                  ? 'bg-rose-100 text-rose-700'
                  : call.status === 'running'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              {call.status}
            </span>
          </div>
          {call.argsSummary ? <p className="mt-1 text-[11.5px] leading-5 text-[var(--ink-soft)]">{call.argsSummary}</p> : null}
          {call.outputSummary ? <p className="mt-1 text-[11.5px] leading-5 text-[var(--ink-soft)]">{call.outputSummary}</p> : null}
        </div>
      ))}
    </div>
  </details>
)

const SessionRow = ({
  session,
  isActive,
  onSelect
}: {
  session: SessionMeta
  isActive: boolean
  onSelect: () => void
}) => (
  <button
    type="button"
    onClick={onSelect}
    className={`group flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition ${
      isActive ? 'bg-[#e4e4e4] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]' : 'hover:bg-[#e8e8e8]/70'
    }`}
  >
    <span
      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
        isActive ? 'bg-white text-[var(--ink-main)]' : 'bg-[#f2f2f2] text-[var(--ink-faint)]'
      }`}
    >
      {isActive ? <span className="text-[15px] leading-none">🦞</span> : <ChatIcon />}
    </span>
    <span className="min-w-0 flex-1">
      <span className="line-clamp-1 text-[14px] font-semibold text-[#2b2b2b]">{session.title}</span>
      <span className="mt-0.5 block text-[12px] leading-5 text-[#7b7b7b]">
        {session.status === 'running' ? '正在生成回复…' : `${session.messageCount} 条消息`}
      </span>
    </span>
    {!isActive ? <span className="pt-0.5 text-[11px] text-[#8a8a8a]">{formatSessionTime(session.updatedAt)}</span> : null}
  </button>
)

const TranscriptItem = ({ entry }: { entry: TranscriptEntry }) => {
  if (entry.kind === 'user') {
    const message = entry as UserTranscriptEntry
    return (
      <div className="flex justify-end">
        <div className="max-w-[62%] rounded-3xl bg-[#1a1a1a] px-4 py-3.5 text-[14px] leading-7 text-white shadow-[0_4px_20px_rgba(0,0,0,0.15)]">
          <p className="whitespace-pre-wrap">{message.text}</p>
          <time className="mt-2 block text-[11px] text-white/50">{formatClockTime(message.createdAt)}</time>
        </div>
      </div>
    )
  }

  if (entry.kind === 'assistant') {
    const message = entry as AssistantTranscriptEntry
    return (
      <div className="max-w-[78%]">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f5f5f7] text-[var(--ink-subtle)]">
            <BoltIcon />
          </span>
          <span className="text-[12px] font-semibold text-[var(--ink-main)]">龙虾管家</span>
          {message.isStreaming ? <span className="h-2 w-2 animate-pulse-dot rounded-full bg-emerald-500" /> : null}
        </div>
        <div className="rounded-3xl border border-[var(--border-soft)] bg-white px-5 py-4 text-[14px] leading-7 text-[var(--ink-main)] shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
          <p className="whitespace-pre-wrap">{message.text || '处理中…'}</p>
          {message.toolGroup ? (
            <div className="mt-4">
              <ToolGroupPanel toolGroup={message.toolGroup} />
            </div>
          ) : null}
          <time className="mt-3 block text-[11px] text-[var(--ink-faint)]">
            {message.isStreaming ? '实时生成中' : formatClockTime(message.completedAt ?? message.createdAt)}
          </time>
        </div>
      </div>
    )
  }

  const message = entry as SystemTranscriptEntry
  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-[13px] leading-6 ${
        message.tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-[var(--border-soft)] bg-[#f5f5f7] text-[var(--ink-soft)]'
      }`}
    >
      {message.text}
    </div>
  )
}

const EmptyState = () => (
  <div className="mx-auto flex h-full w-full max-w-[680px] flex-col px-6 pt-16">
    <div className="mb-12 text-center">
      <h1 className="text-[28px] font-semibold tracking-tight text-[var(--ink-main)]">有什么可以帮你的?</h1>
      <p className="mt-2 text-[15px] text-[var(--ink-faint)]">描述你的任务,我会帮你完成</p>
    </div>

    <div className="mb-10 grid grid-cols-2 gap-4">
      {CAPABILITY_ITEMS.map((item) => (
        <div key={item.title} className="rounded-2xl border border-[var(--border-soft)] bg-white p-5 shadow-[0_2px_12px_rgba(0,0,0,0.03)]">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#f5f5f7]">
            {item.icon === 'brief' ? <BriefIcon /> : <SparkIcon />}
          </div>
          <h3 className="text-[15px] font-semibold text-[var(--ink-main)]">{item.title}</h3>
          <p className="mt-1.5 text-[13px] leading-5 text-[var(--ink-soft)]">{item.description}</p>
        </div>
      ))}
    </div>

    <div className="mb-10">
      <h3 className="mb-4 text-[14px] font-medium text-[var(--ink-faint)]">适用场景</h3>
      <div className="space-y-2">
        {SCENARIO_ITEMS.map((item) => (
          <div key={item.text} className="flex items-center gap-3 text-[14px] text-[var(--ink-soft)]">
            <span>{item.icon}</span>
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </div>

    <div>
      <h3 className="mb-4 text-[14px] font-medium text-[var(--ink-faint)]">试试这样问我</h3>
      <div className="flex flex-col gap-2">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="flex w-full items-center justify-between rounded-full border border-[var(--border-soft)] bg-white px-5 py-3.5 text-left text-[14px] text-[var(--ink-soft)] shadow-[0_2px_8px_rgba(0,0,0,0.02)] transition hover:border-[var(--border-medium)] hover:text-[var(--ink-main)]"
          >
            <span>{prompt}</span>
            <ArrowIcon />
          </button>
        ))}
      </div>
    </div>
  </div>
)

const BootErrorState = ({ message }: { message: string }) => (
  <div className="mx-auto mt-12 max-w-[720px] rounded-3xl border border-rose-200 bg-rose-50/80 px-6 py-6 shadow-[0_8px_32px_rgba(153,27,27,0.06)]">
    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-rose-500">启动异常</div>
    <h3 className="mt-3 text-[20px] font-semibold text-rose-950">会话界面初始化失败</h3>
    <pre className="mt-4 whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-rose-700">{message}</pre>
  </div>
)

const InputBar = ({
  draft,
  isRunning,
  isCancelling,
  currentSessionId,
  onDraftChange,
  onSend,
  onCancel
}: {
  draft: string
  isRunning: boolean
  isCancelling: boolean
  currentSessionId: string | null
  onDraftChange: (value: string) => void
  onSend: () => void
  onCancel: () => void
}) => (
  <div className="rounded-[28px] border border-[#ececf0] bg-[#f7f7f9] px-5 py-4 shadow-[0_10px_30px_rgba(15,15,20,0.06)]">
    <textarea
      value={draft}
      onChange={(event) => onDraftChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          onSend()
        }
      }}
      rows={1}
      placeholder="输入你的问题或任务描述..."
      className="block min-h-[46px] w-full resize-none bg-transparent px-1 text-[15px] leading-7 text-[var(--ink-main)] outline-none placeholder:text-[#9b9ca5]"
    />

    <div className="mt-3 flex items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {INPUT_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#ececf1] px-3.5 text-[12.5px] font-medium text-[#4e505a] transition hover:bg-[#e4e4eb] hover:text-[var(--ink-main)]"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[#8f919c]">
              {chip === '默认大模型' ? <BoltIcon /> : chip === '技能' ? <SparkIcon /> : <CompassIcon />}
            </span>
            {chip}
            {chip !== '找灵感' ? <ChevronDownIcon /> : null}
          </button>
        ))}
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#ececf1] text-[#6d707c] transition hover:bg-[#e4e4eb] hover:text-[var(--ink-main)]"
          aria-label="关联内容"
        >
          <LinkIcon />
        </button>
      </div>

      <div className="flex items-center gap-2">
        {isRunning ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={isCancelling}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-[#dddde3] bg-white px-4 text-[13px] font-medium text-[var(--ink-soft)] transition hover:bg-[#f3f3f7] disabled:opacity-50"
          >
            <StopIcon />
            {isCancelling ? '停止中…' : '停止'}
          </button>
        ) : null}

        <button
          type="button"
          onClick={onSend}
          disabled={!draft.trim() || isRunning || !currentSessionId}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#1f1f23] text-white transition hover:bg-[#2b2b31] disabled:cursor-not-allowed disabled:bg-[#e8e8ee] disabled:text-[#b8bac3]"
          aria-label="发送消息"
        >
          <SendIcon />
        </button>
      </div>
    </div>
  </div>
)

export const ChatPage = () => {
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [isBooting, setIsBooting] = useState(true)
  const [bootError, setBootError] = useState<string | null>(null)
  const [state, dispatch] = useReducer(chatViewReducer, undefined, createInitialChatViewState)
  const transcriptRef = useRef<HTMLDivElement>(null)

  const visibleSessions = useMemo(() => selectVisibleSessions(sessions), [sessions])

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' })
  }, [state.transcript, state.isRunning])

  useEffect(() => {
    let disposed = false

    const refreshSessions = async (): Promise<SessionMeta[]> => {
      if (!window.context) {
        throw new Error('Preload API is unavailable. Check the Electron main/preload process logs.')
      }

      const next = await window.context.listSessions()
      if (!disposed) setSessions(next)
      return next
    }

    const openFirstSession = async (): Promise<void> => {
      try {
        const listed = await refreshSessions()
        if (disposed) return

        const target = listed[0] ?? (await window.context.createSession())
        if (!listed[0]) await refreshSessions()

        const snapshot = await window.context.openSession(target.id)
        if (!disposed) {
          setCurrentSessionId(target.id)
          dispatch({ type: 'snapshot.loaded', snapshot })
          setBootError(null)
        }
      } catch (error) {
        if (!disposed) {
          setBootError(error instanceof Error ? error.message : 'Failed to bootstrap chat sessions.')
        }
      } finally {
        if (!disposed) setIsBooting(false)
      }
    }

    void openFirstSession()
    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    if (!currentSessionId) return
    let disposed = false

    const refreshSessions = async (): Promise<void> => {
      try {
        const next = await window.context.listSessions()
        if (!disposed) setSessions(next)
      } catch (error) {
        if (!disposed) {
          setBootError(error instanceof Error ? error.message : 'Failed to refresh sessions.')
        }
      }
    }

    const unsubscribe = window.context.subscribeChatEvents(currentSessionId, (event) => {
      if (disposed) return

      dispatch({ type: 'event.received', event })

      if (
        event.type === 'user.message' ||
        event.type === 'assistant.completed' ||
        event.type === 'session.title.updated' ||
        event.type === 'session.error' ||
        event.type === 'session.cancelled'
      ) {
        void refreshSessions()
      }
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [currentSessionId])

  const openSession = async (sessionId: string): Promise<void> => {
    const snapshot = await window.context.openSession(sessionId)
    setCurrentSessionId(sessionId)
    dispatch({ type: 'snapshot.loaded', snapshot })
    setBootError(null)
  }

  const createSession = async (): Promise<void> => {
    const created = await window.context.createSession()
    const next = await window.context.listSessions()
    setSessions(next)
    await openSession(created.id)
    setDraft('')
    setBootError(null)
  }

  const handleSend = async (): Promise<void> => {
    if (!currentSessionId || !draft.trim() || state.isRunning) return

    const message = draft
    setDraft('')
    dispatch({ type: 'run.requested' })

    try {
      await window.context.sendMessage(currentSessionId, message)
    } catch (error) {
      dispatch({
        type: 'event.received',
        event: {
          type: 'session.error',
          eventId: `local_error_${Date.now()}`,
          sessionId: currentSessionId,
          timestamp: Date.now(),
          message: error instanceof Error ? error.message : 'Unable to send the message.'
        }
      })
    }
  }

  const handleCancel = async (): Promise<void> => {
    if (!currentSessionId || !state.isRunning) return
    dispatch({ type: 'cancel.requested' })
    await window.context.cancelRun(currentSessionId)
  }

  return (
    <>
      <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-[#dddddd] bg-[#efefef] px-3 py-4">
        <div className="space-y-4">
          <label className="flex h-10 items-center gap-2 rounded-full bg-[#e7e7e7] px-4 text-[#8b8b8b]">
            <SearchIcon />
            <input
              type="text"
              placeholder="搜索"
              className="w-full bg-transparent text-[14px] text-[#2a2a2a] outline-none placeholder:text-[#8b8b8b]"
            />
          </label>

          <button
            type="button"
            onClick={() => void createSession()}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-full border border-[#d9d9d9] bg-[#f2f2f2] text-[14px] font-semibold text-[#1f1f1f] transition hover:bg-[#ececec]"
          >
            <PlusIcon />
            新建 Agent
          </button>
        </div>

        <div className="mt-5 flex-1 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            {visibleSessions.length === 0 && !isBooting ? (
              <div className="rounded-2xl bg-[#e4e4e4] px-4 py-5 text-[13px] text-[#7b7b7b]">暂无会话</div>
            ) : (
              visibleSessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  isActive={session.id === currentSessionId}
                  onSelect={() => void openSession(session.id)}
                />
              ))
            )}
          </div>
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--content-bg)]">
        <header className="flex shrink-0 items-center justify-between gap-4 px-6 py-4">
          <div className="hidden items-center gap-2 text-[15px] font-semibold text-[#4f93ff] md:flex">
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-[#f5f5f7]">
              <SparkIcon />
            </span>
            DeepClaw
          </div>
        </header>

        <div ref={transcriptRef} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {isBooting ? (
            <div className="flex h-full items-center justify-center text-[14px] text-[var(--ink-soft)]">正在加载会话…</div>
          ) : bootError ? (
            <BootErrorState message={bootError} />
          ) : state.transcript.length > 0 ? (
            <div className="mx-auto flex w-full max-w-[860px] flex-col gap-6 px-6 py-6">
              {state.transcript.map((entry) => (
                <TranscriptItem key={entry.id} entry={entry} />
              ))}
            </div>
          ) : (
            <EmptyState />
          )}
        </div>

        <div className="shrink-0 px-6 pb-4 pt-2">
          <div className="mx-auto max-w-[860px]">
            <InputBar
              draft={draft}
              isRunning={state.isRunning}
              isCancelling={state.isCancelling}
              currentSessionId={currentSessionId}
              onDraftChange={setDraft}
              onSend={() => void handleSend()}
              onCancel={() => void handleCancel()}
            />
          </div>
        </div>
      </section>
    </>
  )
}
