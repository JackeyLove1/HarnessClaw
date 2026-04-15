import type { SessionMeta } from '@shared/models';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
    chatViewReducer,
    createInitialChatViewState,
    selectVisibleSessions,
    type AssistantTranscriptEntry,
    type SystemTranscriptEntry,
    type ToolGroupView,
    type TranscriptEntry,
    type UserTranscriptEntry
} from '../chat/reducer';

const CAPABILITY_ITEMS = [
  {
    icon: '💼',
    title: '我能做什么?',
    description: '追踪 GDP、利率、CPI 等关键宏观经济数据和央行政策。'
  },
  {
    icon: '🧑‍🏫',
    title: '我是怎么做?',
    description: '支持 GDP/CPI/PMI/社融等、利率/准备金率变化影响查询，美联储/ECB 政策对 A 股影响。'
  }
]

const SCENARIO_ITEMS = [
  { icon: '📊', text: '想了解当前经济处于什么周期阶段' },
  { icon: '✅', text: '想知道利率变动对股市有什么影响' },
  { icon: '🌍', text: '想跟踪全球主要经济体的数据对比' }
]

const QUICK_PROMPTS = ['最新的 GDP 增速和 CPI 数据是多少?', '目前加息周期到哪个阶段了?']
const EMPTY_STATE_BUBBLE = '经济数据查询能帮我做什么呢?'
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

const MoreIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
    <circle cx="5.5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="18.5" cy="12" r="1.8" />
  </svg>
)

const EditIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M12 20h9" />
    <path d="m16.5 3.5 4 4L7 21l-4 1 1-4L16.5 3.5Z" />
  </svg>
)

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="m19 6-1 14H6L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
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
  isMenuOpen,
  isRenaming,
  renameDraft,
  onSelect,
  onToggleMenu,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onStartRename,
  onDelete
}: {
  session: SessionMeta
  isActive: boolean
  isMenuOpen: boolean
  isRenaming: boolean
  renameDraft: string
  onSelect: () => void
  onToggleMenu: () => void
  onRenameDraftChange: (value: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
  onStartRename: () => void
  onDelete: () => void
}) => (
  <div className="relative">
    <button
      type="button"
      onClick={onSelect}
      className={`group flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 pr-11 text-left transition ${
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

      {isRenaming ? (
        <span className="min-w-0 flex-1" onClick={(event) => event.stopPropagation()}>
          <input
            autoFocus
            value={renameDraft}
            onChange={(event) => onRenameDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onCommitRename()
              }

              if (event.key === 'Escape') {
                event.preventDefault()
                onCancelRename()
              }
            }}
            onBlur={onCommitRename}
            className="h-8 w-full rounded-lg border border-[#d8d8dd] bg-white px-2.5 text-[13px] font-medium text-[#2d2d2f] outline-none focus:border-[#bfc0c8]"
          />
        </span>
      ) : (
        <span className="min-w-0 flex-1">
          <span className="line-clamp-1 text-[14px] font-semibold text-[#2b2b2b]">{session.title}</span>
          <span className="mt-0.5 block text-[12px] leading-tight text-[#7b7b7b]">
            {session.status === 'running' ? '正在生成回复…' : `${session.messageCount} 条消息`}
          </span>
        </span>
      )}

      {!isActive && !isRenaming ? <span className="pt-0.5 text-[11px] text-[#8a8a8a]">{formatSessionTime(session.updatedAt)}</span> : null}
    </button>

    {!isRenaming ? (
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onToggleMenu()
        }}
        aria-label="会话更多操作"
        className={`absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[#8d8d94] transition hover:bg-white hover:text-[#2f2f34] ${
          isMenuOpen ? 'bg-white text-[#2f2f34] shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : ''
        }`}
      >
        <MoreIcon />
      </button>
    ) : null}

    {isMenuOpen ? (
      <div className="absolute right-3 top-[42px] z-10 w-[118px] rounded-2xl border border-[#efefef] bg-white p-1 shadow-[0_18px_36px_rgba(15,15,20,0.14)]">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onStartRename()
          }}
          className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-[14px] font-medium text-[#2f2f35] transition hover:bg-[#f4f4f6]"
        >
          <EditIcon />
          编辑名称
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
          className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-[14px] font-medium text-[#2f2f35] transition hover:bg-[#f8f3f3]"
        >
          <TrashIcon />
          删除
        </button>
      </div>
    ) : null}
  </div>
)

const TranscriptItem = ({ entry }: { entry: TranscriptEntry }) => {
  if (entry.kind === 'user') {
    const message = entry as UserTranscriptEntry
    return (
      <div className="flex justify-end pt-1">
        <div className="max-w-[90%] rounded-xl border border-[#f8e7e0] bg-[#fff6f2] px-4 py-2 text-[14px] leading-[1.6] tracking-[0.02em] text-black">
          <p className="whitespace-pre-wrap">{message.text}</p>
        </div>
      </div>
    )
  }

  if (entry.kind === 'assistant') {
    const message = entry as AssistantTranscriptEntry
    return (
      <div className="max-w-[88%] pl-1">
        <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[#6c6d74]">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#f4f4f7] text-[#8d8f98]">
            <SparkIcon />
          </span>
          经济数据助手
          {message.isStreaming ? <span className="h-2 w-2 animate-pulse-dot rounded-full bg-emerald-500" /> : null}
        </div>
        <div className="rounded-2xl bg-transparent px-1 py-1 text-[24px] font-semibold leading-[1.48] tracking-tight text-[var(--ink-main)]">
          <p className="whitespace-pre-wrap">{message.text || '处理中…'}</p>
          {message.toolGroup ? (
            <div className="mt-5 max-w-[780px]">
              <ToolGroupPanel toolGroup={message.toolGroup} />
            </div>
          ) : null}
          <time className="mt-3 block text-[11px] font-medium text-[var(--ink-faint)]">
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
  <div className="mx-auto flex h-full w-full max-w-[980px] flex-col px-8 pb-10 pt-8">
    <div className="flex justify-end">
      <div className="max-w-[360px] rounded-2xl border border-[#f0d7d0] bg-[#fff8f5] px-5 py-3 text-[20px] font-semibold leading-tight tracking-tight text-[#303030] shadow-[0_2px_6px_rgba(0,0,0,0.02)]">
        {EMPTY_STATE_BUBBLE}
      </div>
    </div>

    <div className="mt-20 max-w-[760px]">
      {CAPABILITY_ITEMS.map((item) => (
        <div key={item.title} className="mb-6">
          <h3 className="text-[30px] font-semibold tracking-tight text-[var(--ink-main)]">
            <span className="mr-2.5 align-middle text-[26px]">{item.icon}</span>
            {item.title}
          </h3>
          <p className="mt-2 text-[24px] leading-[1.45] tracking-tight text-[var(--ink-main)]">{item.description}</p>
        </div>
      ))}
    </div>

    <div className="mt-3 max-w-[760px]">
      <h3 className="text-[30px] font-semibold tracking-tight text-[var(--ink-main)]">适用场景：</h3>
      <div className="mt-3 space-y-2.5">
        {SCENARIO_ITEMS.map((item) => (
          <div key={item.text} className="flex items-center gap-3 text-[24px] font-semibold leading-[1.45] tracking-tight text-[var(--ink-main)]">
            <span className="text-[22px]">{item.icon}</span>
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </div>

    <div className="mt-10 border-t border-[var(--border-soft)] pt-8">
      <h3 className="mb-4 text-[28px] font-semibold tracking-tight text-[var(--ink-main)]">可以试试这么问我:</h3>
      <div className="max-w-[760px] space-y-3">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="flex w-full items-center justify-between rounded-3xl border border-[#f0f0f3] bg-[#fbfbfd] px-6 py-3.5 text-left text-[21px] font-medium tracking-tight text-[#5b5b64] shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition hover:border-[#dedee6] hover:text-[var(--ink-main)]"
          >
            <span>{prompt}</span>
            <span className="text-[#b6b8c2]">
              <ArrowIcon />
            </span>
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
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
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

  const startEditingTitle = (session: SessionMeta): void => {
    setMenuSessionId(null)
    setEditingSessionId(session.id)
    setTitleDraft(session.title)
  }

  const commitTitleEdit = async (sessionId: string): Promise<void> => {
    const normalized = titleDraft.trim()
    const current = sessions.find((session) => session.id === sessionId)
    const shouldCancel = !normalized || !current

    if (shouldCancel) {
      setEditingSessionId(null)
      setTitleDraft('')
      return
    }

    if (normalized === current.title) {
      setEditingSessionId(null)
      setTitleDraft('')
      return
    }

    try {
      await window.context.updateSessionTitle(sessionId, normalized)
      const next = await window.context.listSessions()
      setSessions(next)
      setBootError(null)
    } catch (error) {
      setBootError(error instanceof Error ? error.message : 'Failed to update session title.')
    } finally {
      setEditingSessionId(null)
      setTitleDraft('')
    }
  }

  const handleDeleteSession = async (sessionId: string): Promise<void> => {
    const confirmed = window.confirm('确定要删除这个会话吗？该操作无法撤销。')
    if (!confirmed) return

    try {
      await window.context.deleteSession(sessionId)
      const listed = await window.context.listSessions()

      setMenuSessionId(null)
      setEditingSessionId(null)
      setTitleDraft('')

      if (listed.length === 0) {
        const created = await window.context.createSession()
        const refreshed = await window.context.listSessions()
        setSessions(refreshed)
        await openSession(created.id)
        setDraft('')
        setBootError(null)
        return
      }

      setSessions(listed)
      if (currentSessionId === sessionId) {
        await openSession(listed[0].id)
      }
      setBootError(null)
    } catch (error) {
      setBootError(error instanceof Error ? error.message : 'Failed to delete session.')
    }
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
                  isMenuOpen={menuSessionId === session.id}
                  isRenaming={editingSessionId === session.id}
                  renameDraft={editingSessionId === session.id ? titleDraft : session.title}
                  onSelect={() => {
                    setMenuSessionId(null)
                    setEditingSessionId(null)
                    setTitleDraft('')
                    void openSession(session.id)
                  }}
                  onToggleMenu={() => setMenuSessionId((current) => (current === session.id ? null : session.id))}
                  onRenameDraftChange={setTitleDraft}
                  onCommitRename={() => void commitTitleEdit(session.id)}
                  onCancelRename={() => {
                    setEditingSessionId(null)
                    setTitleDraft('')
                  }}
                  onStartRename={() => startEditingTitle(session)}
                  onDelete={() => void handleDeleteSession(session.id)}
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
