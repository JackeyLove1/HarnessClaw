import type { SessionMeta } from '@shared/models';
import {
  ChevronDown,
  ChevronRight,
  Compass,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Send,
  Sparkles,
  Square,
  Trash2,
  Wrench,
  Zap
} from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState, type Ref } from 'react';
import { toast } from 'sonner';
import {
  buildFeedbackKey,
  copyAssistantMessage,
  getLatestAssistantMessageId,
  getRetryPromptForAssistant,
  toggleAssistantFeedback,
  type AssistantFeedback
} from '../chat/messageActions';
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
import { AssistantMessageActions } from '../components/AssistantMessageActions';
import { AssistantMessageMarkdown } from '../components/AssistantMessageMarkdown';

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

const mapSendErrorMessage = (error: unknown): string => {
  const fallback = '发送失败，请稍后重试。'
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const message = raw.trim()
  if (!message) {
    return fallback
  }

  if (message.includes('already responding')) {
    return '当前会话正在回复中，请先点击“停止”后再发送新消息。'
  }

  if (
    message.includes('not configured') ||
    message.includes('missing ANTHROPIC_API_KEY') ||
    message.includes('missing NOTEMARK_MODEL') ||
    message.includes('only supports Anthropic provider')
  ) {
    return '模型配置不完整，请前往“设置”填写 Base URL、API Key、Model，并先执行“测试连接”。'
  }

  if (message.includes('Session not found')) {
    return '当前会话不存在，请新建会话后重试。'
  }

  return message
}

const ToolGroupPanel = ({ toolGroup }: { toolGroup: ToolGroupView }) => {
  const title =
    toolGroup.status === 'running'
      ? '思考中'
      : toolGroup.status === 'error'
        ? '思考完成（含错误）'
        : '已完成思考'

  const statusLabel = (status: ToolGroupView['calls'][number]['status']): string => {
    if (status === 'running') return '执行中'
    if (status === 'error') return '失败'
    return '完成'
  }

  return (
    <details className="group rounded-2xl border border-[var(--border-soft)] bg-white/90 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-left">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#f5f5f7] text-[var(--ink-subtle)]">
            <Wrench className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-[var(--ink-main)]">{title}</div>
            <div className="text-[11px] text-[var(--ink-faint)]">
              {toolGroup.calls.length} 次工具调用
              {toolGroup.totalDurationMs > 0 ? ` · ${toolGroup.totalDurationMs}ms` : ''}
            </div>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-[var(--ink-faint)] transition-transform duration-200 group-open:rotate-90" />
      </summary>
      <div className="border-t border-[var(--border-soft)] px-4 py-2">
        {toolGroup.calls.map((call) => (
          <details
            key={call.id}
            open={call.status === 'running'}
            className="group/call border-b border-[var(--border-soft)] py-2.5 last:border-b-0"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-left">
              <span className="font-mono text-[12px] text-[var(--ink-main)]">{call.name}</span>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    call.status === 'error'
                      ? 'bg-rose-100 text-rose-700'
                      : call.status === 'running'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {statusLabel(call.status)}
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-[var(--ink-faint)] transition-transform duration-200 group-open/call:rotate-90" />
              </div>
            </summary>
            <div className="space-y-1.5 pt-2 text-[11.5px] leading-5 text-[var(--ink-soft)]">
              {call.argsSummary ? <p>{call.argsSummary}</p> : null}
              {call.outputSummary ? <p>{call.outputSummary}</p> : null}
            </div>
          </details>
        ))}
      </div>
    </details>
  )
}

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
        isActive
          ? 'bg-[#e4e4e4] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]'
          : 'hover:bg-[#e8e8e8]/70'
      }`}
    >
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          isActive ? 'bg-white text-[var(--ink-main)]' : 'bg-[#f2f2f2] text-[var(--ink-faint)]'
        }`}
      >
        {isActive ? <span className="text-[15px] leading-none">🦞</span> : <MessageSquare className="h-4 w-4" />}
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
          <span className="line-clamp-1 text-[14px] font-semibold text-[#2b2b2b]">
            {session.title}
          </span>
          <span className="mt-0.5 block text-[12px] leading-tight text-[#7b7b7b]">
            {session.status === 'running' ? '正在生成回复…' : `${session.messageCount} 条消息`}
          </span>
        </span>
      )}

      {!isActive && !isRenaming ? (
        <span className="pt-0.5 text-[11px] text-[#8a8a8a]">
          {formatSessionTime(session.updatedAt)}
        </span>
      ) : null}
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
        <MoreHorizontal className="h-4 w-4" />
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
          <Pencil className="h-4 w-4" />
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
          <Trash2 className="h-4 w-4" />
          删除
        </button>
      </div>
    ) : null}
  </div>
)

const TranscriptItem = ({
  entry,
  showAssistantActions,
  copied,
  feedback,
  disableRetry,
  onCopy,
  onFeedback,
  onRetry
}: {
  entry: TranscriptEntry
  showAssistantActions: boolean
  copied: boolean
  feedback: AssistantFeedback
  disableRetry: boolean
  onCopy: () => void
  onFeedback: (value: Exclude<AssistantFeedback, null>) => void
  onRetry: () => void
}) => {
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
        {/* <div className="mb-2 flex items-center gap-2 text-[8px] font-semibold text-[#6c6d74]">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full">
            <Sparkles
              className={`h-8 w-8 shrink-0 ${message.isStreaming ? 'animate-spin' : ''}`}
              aria-hidden
            />
          </span>
          {message.isStreaming ? (
            <span className="h-2 w-2 animate-pulse-dot rounded-full bg-emerald-500" />
          ) : null}
        </div> */}
        <div className="rounded-2xl bg-transparent px-1 py-1 text-[16px] font-normal leading-[1.48] tracking-tight text-[var(--ink-main)]">
          {message.toolGroup ? (
            <div className="mb-4 max-w-[780px]">
              <ToolGroupPanel toolGroup={message.toolGroup} />
            </div>
          ) : null}
          {message.text.trim() ? (
            <AssistantMessageMarkdown content={message.text} />
          ) : (
            <p className="whitespace-pre-wrap font-semibold">处理中…</p>
          )}
          {!showAssistantActions ? (
            <time className="mt-3 block text-[11px] font-medium text-[var(--ink-faint)]">
              {message.isStreaming
                ? '思考中'
                : formatClockTime(message.completedAt ?? message.createdAt)}
            </time>
          ) : null}
          {showAssistantActions ? (
            <AssistantMessageActions
              copied={copied}
              feedback={feedback}
              disableCopy={!message.text.trim()}
              disableRetry={disableRetry}
              onCopy={onCopy}
              onFeedback={onFeedback}
              onRetry={onRetry}
            />
          ) : null}
        </div>
      </div>
    )
  }

  const message = entry as SystemTranscriptEntry
  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-[13px] leading-6 ${
        message.tone === 'error'
          ? 'border-rose-200 bg-rose-50 text-rose-700'
          : 'border-[var(--border-soft)] bg-[#f5f5f7] text-[var(--ink-soft)]'
      }`}
    >
      {message.text}
    </div>
  )
}

const BootErrorState = ({ message }: { message: string }) => (
  <div className="mx-auto mt-12 max-w-[720px] rounded-3xl border border-rose-200 bg-rose-50/80 px-6 py-6 shadow-[0_8px_32px_rgba(153,27,27,0.06)]">
    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-rose-500">
      启动异常
    </div>
    <h3 className="mt-3 text-[20px] font-semibold text-rose-950">会话界面初始化失败</h3>
    <pre className="mt-4 whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-rose-700">
      {message}
    </pre>
  </div>
)

const InputBar = ({
  draft,
  isRunning,
  isCancelling,
  currentSessionId,
  textareaRef,
  onDraftChange,
  onSend,
  onCancel
}: {
  draft: string
  isRunning: boolean
  isCancelling: boolean
  currentSessionId: string | null
  textareaRef?: Ref<HTMLTextAreaElement>
  onDraftChange: (value: string) => void
  onSend: () => void
  onCancel: () => void
}) => (
  <div className="rounded-[28px] border border-[#ececf0] bg-[#f7f7f9] px-5 py-4 shadow-[0_10px_30px_rgba(15,15,20,0.06)]">
    <textarea
      ref={textareaRef}
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
              {chip === '默认大模型' ? (
                <Zap className="h-4 w-4" />
              ) : chip === '技能' ? (
                <Sparkles className="h-4 w-4" />
              ) : (
                <Compass className="h-4 w-4" />
              )}
            </span>
            {chip}
            {chip !== '找灵感' ? <ChevronDown className="h-3.5 w-3.5" /> : null}
          </button>
        ))}
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#ececf1] text-[#6d707c] transition hover:bg-[#e4e4eb] hover:text-[var(--ink-main)]"
          aria-label="关联内容"
        >
          <Link2 className="h-4 w-4" />
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
            <Square className="h-3.5 w-3.5 fill-current" strokeWidth={0} />
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
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  </div>
)

const EmptyState = ({
  draft,
  isRunning,
  isCancelling,
  currentSessionId,
  textareaRef,
  onDraftChange,
  onSend,
  onCancel
}: {
  draft: string
  isRunning: boolean
  isCancelling: boolean
  currentSessionId: string | null
  textareaRef?: Ref<HTMLTextAreaElement>
  onDraftChange: (value: string) => void
  onSend: () => void
  onCancel: () => void
}) => (
  <div className="mx-auto flex h-full w-full max-w-[860px] flex-col items-center justify-center px-6 pb-8">
    <h2 className="text-center text-[clamp(28px,4.5vw,46px)] font-semibold tracking-tight text-[var(--ink-main)]">
      我能帮您什么?
    </h2>
    <div className="mt-8 w-full">
      <InputBar
        draft={draft}
        isRunning={isRunning}
        isCancelling={isCancelling}
        currentSessionId={currentSessionId}
        textareaRef={textareaRef}
        onDraftChange={onDraftChange}
        onSend={onSend}
        onCancel={onCancel}
      />
    </div>
  </div>
)

export const ChatPage = () => {
  const AUTO_SCROLL_BOTTOM_THRESHOLD = 96
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [isBooting, setIsBooting] = useState(true)
  const [bootError, setBootError] = useState<string | null>(null)
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [copiedAssistantId, setCopiedAssistantId] = useState<string | null>(null)
  const [assistantFeedbackByKey, setAssistantFeedbackByKey] = useState<
    Record<string, AssistantFeedback>
  >({})
  const [state, dispatch] = useReducer(chatViewReducer, undefined, createInitialChatViewState)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const currentSessionIdRef = useRef<string | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const shouldFocusComposerRef = useRef(false)
  const copyFeedbackTimeoutRef = useRef<number | null>(null)
  const shouldAutoScrollRef = useRef(true)
  const hasTranscript = state.transcript.length > 0

  const visibleSessions = useMemo(() => selectVisibleSessions(sessions), [sessions])
  const latestAssistantMessageId = useMemo(
    () => getLatestAssistantMessageId(state.transcript),
    [state.transcript]
  )
  const retryPrompt = useMemo(
    () =>
      latestAssistantMessageId
        ? getRetryPromptForAssistant(state.transcript, latestAssistantMessageId)
        : null,
    [latestAssistantMessageId, state.transcript]
  )

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId
  }, [currentSessionId])

  useEffect(
    () => () => {
      if (copyFeedbackTimeoutRef.current) {
        window.clearTimeout(copyFeedbackTimeoutRef.current)
      }
    },
    []
  )

  useEffect(() => {
    setCopiedAssistantId(null)
  }, [currentSessionId])

  useEffect(() => {
    shouldAutoScrollRef.current = true
  }, [currentSessionId])

  useEffect(() => {
    const transcript = transcriptRef.current
    if (!transcript) return

    const updateShouldAutoScroll = () => {
      const distanceToBottom =
        transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight
      shouldAutoScrollRef.current = distanceToBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD
    }

    updateShouldAutoScroll()
    transcript.addEventListener('scroll', updateShouldAutoScroll, { passive: true })
    return () => {
      transcript.removeEventListener('scroll', updateShouldAutoScroll)
    }
  }, [currentSessionId, hasTranscript, AUTO_SCROLL_BOTTOM_THRESHOLD])

  useEffect(() => {
    if (!hasTranscript || !shouldAutoScrollRef.current) return

    const transcript = transcriptRef.current
    if (!transcript) return

    const rafId = requestAnimationFrame(() => {
      transcript.scrollTo({
        top: transcript.scrollHeight,
        behavior: state.isRunning ? 'auto' : 'smooth'
      })
    })

    return () => cancelAnimationFrame(rafId)
  }, [state.transcript, state.isRunning, hasTranscript])

  useEffect(() => {
    if (!shouldFocusComposerRef.current) return

    shouldFocusComposerRef.current = false
    const rafId = requestAnimationFrame(() => {
      const composer = composerRef.current
      if (!composer) return

      composer.focus()
      const length = composer.value.length
      composer.setSelectionRange(length, length)
    })

    return () => cancelAnimationFrame(rafId)
  }, [currentSessionId, hasTranscript])

  useEffect(() => {
    let disposed = false

    const refreshSessions = async (): Promise<SessionMeta[]> => {
      if (!window.context) {
        throw new Error('Preload API is unavailable. Check the Electron main/preload process logs.')
      }

      const next = await window.context.searchSessions(searchQuery)
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
          setBootError(
            error instanceof Error ? error.message : 'Failed to bootstrap chat sessions.'
          )
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
        const next = await window.context.searchSessions(searchQuery)
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
  }, [currentSessionId, searchQuery])

  useEffect(() => {
    if (isBooting) return
    let disposed = false

    const refreshSessionsByQuery = async (): Promise<void> => {
      try {
        const next = await window.context.searchSessions(searchQuery)
        if (!disposed) {
          setSessions(next)
        }
      } catch (error) {
        if (!disposed) {
          setBootError(error instanceof Error ? error.message : 'Failed to search sessions.')
        }
      }
    }

    void refreshSessionsByQuery()
    return () => {
      disposed = true
    }
  }, [isBooting, searchQuery])

  const openSession = async (sessionId: string): Promise<void> => {
    const snapshot = await window.context.openSession(sessionId)
    setCurrentSessionId(sessionId)
    dispatch({ type: 'snapshot.loaded', snapshot })
    setBootError(null)
  }

  const createSession = async (): Promise<void> => {
    shouldFocusComposerRef.current = true
    const created = await window.context.createSession()
    const next = await window.context.searchSessions(searchQuery)
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
      const next = await window.context.searchSessions(searchQuery)
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
      const listed = await window.context.searchSessions(searchQuery)

      setMenuSessionId(null)
      setEditingSessionId(null)
      setTitleDraft('')

      if (listed.length === 0) {
        const created = await window.context.createSession()
        const refreshed = await window.context.searchSessions(searchQuery)
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

  const runMessage = async (
    sessionId: string,
    message: string,
    options?: { clearDraft?: boolean }
  ): Promise<void> => {
    if (!message.trim() || state.isRunning) return

    if (options?.clearDraft) {
      setDraft('')
    }

    dispatch({ type: 'run.requested' })

    try {
      await window.context.sendMessage(sessionId, message)

      // Re-sync from persisted events after the turn settles in main process.
      // This prevents UI from getting stuck in "running" if any live IPC event was missed.
      const snapshot = await window.context.openSession(sessionId)
      if (currentSessionIdRef.current === sessionId) {
        dispatch({ type: 'snapshot.loaded', snapshot })
      }
    } catch (error) {
      dispatch({
        type: 'event.received',
        event: {
          type: 'session.error',
          eventId: `local_error_${Date.now()}`,
          sessionId,
          timestamp: Date.now(),
          message: mapSendErrorMessage(error)
        }
      })
    }
  }

  const handleSend = async (): Promise<void> => {
    if (!currentSessionId) return
    await runMessage(currentSessionId, draft, { clearDraft: true })
  }

  const handleCopyAssistant = async (message: AssistantTranscriptEntry): Promise<void> => {
    const copied = await copyAssistantMessage(message)
    if (!copied) {
      toast.error('复制失败，请重试')
      return
    }

    setCopiedAssistantId(message.id)
    toast.success('复制成功')
    if (copyFeedbackTimeoutRef.current) {
      window.clearTimeout(copyFeedbackTimeoutRef.current)
    }
    copyFeedbackTimeoutRef.current = window.setTimeout(() => {
      setCopiedAssistantId((current) => (current === message.id ? null : current))
    }, 1500)
  }

  const handleFeedback = (assistantMessageId: string, value: Exclude<AssistantFeedback, null>): void => {
    if (!currentSessionId) return

    const key = buildFeedbackKey(currentSessionId, assistantMessageId)
    setAssistantFeedbackByKey((prev) => toggleAssistantFeedback(prev, key, value))
  }

  const handleRetryLatestAssistant = async (): Promise<void> => {
    if (!currentSessionId || !latestAssistantMessageId) return

    const prompt = retryPrompt ?? getRetryPromptForAssistant(state.transcript, latestAssistantMessageId)
    if (!prompt) return

    await runMessage(currentSessionId, prompt)
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
            <Search className="h-4 w-4" />
            <input
              type="text"
              placeholder="搜索"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full bg-transparent text-[14px] text-[#2a2a2a] outline-none placeholder:text-[#8b8b8b]"
            />
          </label>

          <button
            type="button"
            onClick={() => void createSession()}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-full border border-[#d9d9d9] bg-[#f2f2f2] text-[14px] font-semibold text-[#1f1f1f] transition hover:bg-[#ececec]"
          >
            <Plus className="h-4 w-4" strokeWidth={2.2} />
            新建 Agent
          </button>
        </div>

        <div className="mt-5 flex-1 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            {visibleSessions.length === 0 && !isBooting ? (
              <div className="rounded-2xl bg-[#e4e4e4] px-4 py-5 text-[13px] text-[#7b7b7b]">
                暂无会话
              </div>
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
                  onToggleMenu={() =>
                    setMenuSessionId((current) => (current === session.id ? null : session.id))
                  }
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
          {/* <div className="hidden items-center gap-2 text-[15px] font-semibold text-[#4f93ff] md:flex">
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-[#f5f5f7]">
              <Sparkles className="h-4 w-4" />
            </span>
            DeepClaw
          </div> */}
        </header>

        <div ref={transcriptRef} className={`min-h-0 flex-1 overflow-y-auto px-2 ${hasTranscript ? 'pb-2' : ''}`}>
          {isBooting ? (
            <div className="flex h-full items-center justify-center text-[14px] text-[var(--ink-soft)]">
              正在加载会话…
            </div>
          ) : bootError ? (
            <BootErrorState message={bootError} />
          ) : hasTranscript ? (
            <div className="mx-auto flex w-full max-w-[860px] flex-col gap-6 px-6 py-6">
              {state.transcript.map((entry) => {
                const showAssistantActions =
                  entry.kind === 'assistant' && entry.id === latestAssistantMessageId

                const feedbackKey =
                  currentSessionId && entry.kind === 'assistant'
                    ? buildFeedbackKey(currentSessionId, entry.id)
                    : null

                return (
                  <TranscriptItem
                    key={entry.id}
                    entry={entry}
                    showAssistantActions={showAssistantActions}
                    copied={entry.kind === 'assistant' && copiedAssistantId === entry.id}
                    feedback={feedbackKey ? assistantFeedbackByKey[feedbackKey] ?? null : null}
                    disableRetry={!retryPrompt || state.isRunning}
                    onCopy={() => {
                      if (entry.kind !== 'assistant') return
                      void handleCopyAssistant(entry)
                    }}
                    onFeedback={(value) => {
                      if (entry.kind !== 'assistant') return
                      handleFeedback(entry.id, value)
                    }}
                    onRetry={() => void handleRetryLatestAssistant()}
                  />
                )
              })}
            </div>
          ) : (
            <EmptyState
              draft={draft}
              isRunning={state.isRunning}
              isCancelling={state.isCancelling}
              currentSessionId={currentSessionId}
              textareaRef={composerRef}
              onDraftChange={setDraft}
              onSend={() => void handleSend()}
              onCancel={() => void handleCancel()}
            />
          )}
        </div>

        {hasTranscript ? (
          <div className="shrink-0 px-6 pb-4 pt-2">
            <div className="mx-auto max-w-[860px]">
              <InputBar
                draft={draft}
                isRunning={state.isRunning}
                isCancelling={state.isCancelling}
                currentSessionId={currentSessionId}
                textareaRef={composerRef}
                onDraftChange={setDraft}
                onSend={() => void handleSend()}
                onCancel={() => void handleCancel()}
              />
            </div>
          </div>
        ) : null}
      </section>
    </>
  )
}
