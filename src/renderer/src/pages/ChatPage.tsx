import type {
    ChatCanvasArtifact,
    ChatImageAttachment,
    ChatToolArtifact,
    SessionMeta
} from '@shared/models';
import type {
    AiChannelConfig,
    AiChannelSettings,
    ClipboardImagePayload,
    InstalledSkillSummary,
    PendingImageAttachment
} from '@shared/types';
import {
    Check,
    ChevronDown,
    ChevronRight,
    FileCode2,
    Link2,
    LoaderCircle,
    MessageSquare,
    MoreHorizontal,
    PanelRightOpen,
    Pencil,
    Plus,
    Search,
    Send,
    Sparkles,
    Square,
    Trash2,
    Wrench,
    X,
    Zap
} from 'lucide-react';
import {
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
    type ClipboardEvent,
    type Ref
} from 'react';
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '../components/ui/dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '../components/ui/dropdown-menu';
import {
    CanvasPage,
    type CanvasArtifactView,
    type CanvasViewportMode
} from './CanvasPage';

const MAX_PENDING_IMAGES = 5
const MAX_PENDING_IMAGE_BYTES = 8 * 1024 * 1024
const MIME_TO_EXTENSION: Record<ChatImageAttachment['mimeType'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp'
}
const SUPPORTED_CHAT_IMAGE_TYPES = new Set<ChatImageAttachment['mimeType']>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp'
])

type PendingComposerImage = PendingImageAttachment & {
  previewUrl: string
  sizeBytes: number
  width: number
  height: number
}

type PendingPromptFile = {
  filePath: string
  fileName: string
}

const isCanvasArtifact = (artifact: ChatToolArtifact): artifact is ChatCanvasArtifact =>
  'kind' in artifact && artifact.kind === 'canvas'

const isImageArtifact = (artifact: ChatToolArtifact): artifact is ChatImageAttachment =>
  !isCanvasArtifact(artifact)

const chatImageDebug = (label: string, payload?: unknown): void => {
  if (!import.meta.env.DEV) {
    return
  }

  if (payload === undefined) {
    console.debug(`[chat-image-debug] ${label}`)
    return
  }

  console.debug(`[chat-image-debug] ${label}`, payload)
}

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
    message.includes('active AI channel') ||
    message.includes('only supports Anthropic-compatible channels')
  ) {
    return '当前 AI Channel 配置不完整，请前往“设置”填写 Base URL、API Key、Model，并先执行“测试连接”。'
  }

  if (message.includes('Session not found')) {
    return '当前会话不存在，请新建会话后重试。'
  }

  return message
}

const formatBytes = (value: number): string => {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`
  }

  return `${Math.max(1, Math.round(value / 1024))} KB`
}

const formatAiChannelLabel = (channel: AiChannelConfig): string =>
  `${channel.name} · ${channel.model}`

const toFileSrc = (filePath: string): string => {
  if (!filePath) {
    return filePath
  }

  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/\/\?\//, '')
  const encodePathSegments = (value: string): string =>
    value
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')

  if (/^[A-Za-z]:\//.test(normalizedPath)) {
    const drive = normalizedPath.slice(0, 2)
    const tail = normalizedPath.slice(2)
    return `file:///${drive}${encodePathSegments(tail)}`
  }

  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(normalizedPath)) {
    return normalizedPath
  }

  const encoded = encodePathSegments(normalizedPath)
  return `file://${encoded.startsWith('/') ? '' : '/'}${encoded}`
}

const getFileNameFromPath = (filePath: string): string => {
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/\/+$/, '')
  const maybeName = normalizedPath.split('/').pop()?.trim()
  return maybeName || filePath
}

const prependPromptFilePath = (prompt: string, filePath: string): string => {
  const header = `文件地址: ${filePath}`
  if (!prompt.trim()) {
    return header
  }
  return `${header}\n${prompt}`
}

const releasePendingImages = (images: PendingComposerImage[]): void => {
  for (const image of images) {
    if (image.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(image.previewUrl)
    }
  }
}

const readFileAsDataUrl = async (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read clipboard image.'))
    reader.readAsDataURL(file)
  })

const readImageDimensions = async (src: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      reject(new Error('Failed to read image dimensions.'))
    }
    image.src = src
  })

const normalizeImageDimensions = (value?: { width: number; height: number } | null) => {
  if (!value) {
    return null
  }

  const width = Number.isFinite(value.width) ? Math.round(value.width) : 0
  const height = Number.isFinite(value.height) ? Math.round(value.height) : 0
  if (width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

const readImageDimensionsSafely = async (
  src: string,
  fallback?: { width: number; height: number }
): Promise<{ width: number; height: number }> => {
  try {
    const measured = normalizeImageDimensions(await readImageDimensions(src))
    if (measured) {
      return measured
    }
  } catch (error) {
    chatImageDebug('readImageDimensions failed', { error })
  }

  return normalizeImageDimensions(fallback) ?? { width: 0, height: 0 }
}

const buildPendingImageFromClipboardPayload = async (
  payload: ClipboardImagePayload,
  index = 0
): Promise<PendingComposerImage> => {
  const extension = MIME_TO_EXTENSION[payload.mimeType]
  const previewUrl = `data:${payload.mimeType};base64,${payload.dataBase64}`
  const dimensions = await readImageDimensionsSafely(previewUrl, {
    width: payload.width,
    height: payload.height
  })

  return {
    id: crypto.randomUUID(),
    fileName: `pasted-image-${Date.now()}-${index + 1}.${extension}`,
    mimeType: payload.mimeType,
    dataBase64: payload.dataBase64,
    sizeBytes: payload.sizeBytes,
    width: dimensions.width,
    height: dimensions.height,
    previewUrl
  }
}

const collectCanvasArtifacts = (transcript: TranscriptEntry[]): CanvasArtifactView[] =>
  transcript.flatMap((entry) => {
    if (entry.kind !== 'assistant' || !entry.toolGroup) {
      return []
    }

    return entry.toolGroup.calls.flatMap((call) =>
      call.artifacts.filter(isCanvasArtifact).map((artifact) => ({
        artifact,
        toolCallId: call.id,
        toolName: call.name,
        outputSummary: call.outputSummary,
        assistantMessageId: entry.id,
        timestamp: artifact.createdAt || entry.completedAt || entry.createdAt
      }))
    )
  })

const ToolGroupPanel = ({
  toolGroup,
  activeCanvasArtifactId,
  onPreviewCanvas
}: {
  toolGroup: ToolGroupView
  activeCanvasArtifactId: string | null
  onPreviewCanvas: (artifact: ChatCanvasArtifact) => void
}) => {
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
              {call.artifacts.filter(isCanvasArtifact).length > 0 ? (
                <div className="grid gap-2 pt-1">
                  {call.artifacts.filter(isCanvasArtifact).map((artifact) => (
                    <button
                      key={artifact.id}
                      type="button"
                      onClick={() => onPreviewCanvas(artifact)}
                      className={`flex items-center justify-between gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                        activeCanvasArtifactId === artifact.id
                          ? 'border-[#d2c2b6] bg-[#f7f1eb]'
                          : 'border-[#eadfd7] bg-white hover:border-[#d8c3b2] hover:bg-[#fbf7f3]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[12px] font-semibold text-[#312d2a]">
                          <FileCode2 className="h-4 w-4 shrink-0" />
                          <span className="truncate">{artifact.title}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-[#7f8088]">
                          HTML canvas · {formatBytes(artifact.sizeBytes)}
                        </div>
                      </div>
                      <span className="rounded-full bg-[#efe3d8] px-2.5 py-1 text-[10px] font-semibold text-[#5d4738]">
                        {activeCanvasArtifactId === artifact.id ? 'Open' : 'Preview'}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              {call.artifacts.filter(isImageArtifact).length > 0 ? (
                <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-3">
                  {call.artifacts.filter(isImageArtifact).map((artifact) => (
                    <div
                      key={artifact.id}
                      className="overflow-hidden rounded-2xl border border-[#eadfd7] bg-white"
                    >
                      <img
                        src={toFileSrc(artifact.filePath)}
                        alt={artifact.fileName}
                        className="h-28 w-full object-cover"
                        loading="lazy"
                      />
                      <div className="border-t border-[#f1e8e2] px-3 py-2">
                        <div className="line-clamp-1 text-[12px] font-medium text-[#3a3a3d]">
                          {artifact.fileName}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[#7f8088]">
                          {artifact.width}脳{artifact.height}
                          {artifact.sizeBytes ? ` 路 ${formatBytes(artifact.sizeBytes)}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
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
        {isActive ? (
          <span className="text-[15px] leading-none">🦞</span>
        ) : (
          <MessageSquare className="h-4 w-4" />
        )}
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

const UserAttachmentGrid = ({
  attachments,
  allowRemove,
  onRemove
}: {
  attachments: Array<
    Pick<ChatImageAttachment, 'id' | 'fileName' | 'width' | 'height'> & {
      src: string
      sizeBytes?: number
    }
  >
  allowRemove?: boolean
  onRemove?: (id: string) => void
}) => (
  <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
    {attachments.map((attachment) => (
      <div
        key={attachment.id}
        className="relative overflow-hidden rounded-2xl border border-[#eadfd7] bg-white"
      >
        <img
          src={attachment.src}
          alt={attachment.fileName}
          className="h-32 w-full object-cover"
          loading="lazy"
        />
        {allowRemove && onRemove ? (
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white transition hover:bg-black/75"
            aria-label={`移除 ${attachment.fileName}`}
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
        <div className="border-t border-[#f1e8e2] px-3 py-2">
          <div className="line-clamp-1 text-[12px] font-medium text-[#3a3a3d]">
            {attachment.fileName}
          </div>
          <div className="mt-0.5 text-[11px] text-[#7f8088]">
            {attachment.width > 0 && attachment.height > 0
              ? `${attachment.width}×${attachment.height}`
              : '已粘贴图片'}
            {attachment.sizeBytes ? ` · ${formatBytes(attachment.sizeBytes)}` : ''}
          </div>
        </div>
      </div>
    ))}
  </div>
)

const TranscriptItem = ({
  entry,
  showAssistantActions,
  copied,
  feedback,
  disableRetry,
  activeCanvasArtifactId,
  resolveUserAttachmentSrc,
  onPreviewCanvas,
  onCopy,
  onFeedback,
  onRetry
}: {
  entry: TranscriptEntry
  showAssistantActions: boolean
  copied: boolean
  feedback: AssistantFeedback
  disableRetry: boolean
  activeCanvasArtifactId: string | null
  resolveUserAttachmentSrc: (attachment: ChatImageAttachment) => string
  onPreviewCanvas: (artifact: ChatCanvasArtifact) => void
  onCopy: () => void
  onFeedback: (value: Exclude<AssistantFeedback, null>) => void
  onRetry: () => void
}) => {
  if (entry.kind === 'user') {
    const message = entry as UserTranscriptEntry
    return (
      <div className="flex justify-end pt-1">
        <div className="max-w-[90%] rounded-xl border border-[#f8e7e0] bg-[#fff6f2] px-4 py-2 text-[14px] leading-[1.6] tracking-[0.02em] text-black">
          {message.attachments.length > 0 ? (
            <UserAttachmentGrid
              attachments={message.attachments.map((attachment) => ({
                ...attachment,
                src: resolveUserAttachmentSrc(attachment)
              }))}
            />
          ) : null}
          {message.text.trim() ? <p className="whitespace-pre-wrap">{message.text}</p> : null}
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
              <ToolGroupPanel
                toolGroup={message.toolGroup}
                activeCanvasArtifactId={activeCanvasArtifactId}
                onPreviewCanvas={onPreviewCanvas}
              />
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
  pendingImages,
  pendingPromptFile,
  isRunning,
  isCancelling,
  currentSessionId,
  aiChannelSettings,
  installedSkills,
  selectedSkillIds,
  isAiChannelsLoading,
  isInstalledSkillsLoading,
  isSwitchingAiChannel,
  textareaRef,
  onDraftChange,
  onPaste,
  onRemoveImage,
  onToggleSkill,
  onActiveChannelChange,
  onPickPromptFile,
  onRemovePromptFile,
  onSend,
  onCancel
}: {
  draft: string
  pendingImages: PendingComposerImage[]
  pendingPromptFile: PendingPromptFile | null
  isRunning: boolean
  isCancelling: boolean
  currentSessionId: string | null
  aiChannelSettings: AiChannelSettings
  installedSkills: InstalledSkillSummary[]
  selectedSkillIds: string[]
  isAiChannelsLoading: boolean
  isInstalledSkillsLoading: boolean
  isSwitchingAiChannel: boolean
  textareaRef?: Ref<HTMLTextAreaElement>
  onDraftChange: (value: string) => void
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void
  onRemoveImage: (id: string) => void
  onToggleSkill: (skillId: string) => void
  onActiveChannelChange: (channelId: string) => void
  onPickPromptFile: () => void
  onRemovePromptFile: () => void
  onSend: () => void
  onCancel: () => void
}) => {
  const activeChannel =
    aiChannelSettings.channels.find(
      (channel) => channel.id === aiChannelSettings.activeChannelId
    ) ?? null
  const activeChannelLabel = activeChannel ? formatAiChannelLabel(activeChannel) : '默认大模型'
  const isModelSwitcherDisabled =
    isAiChannelsLoading || isSwitchingAiChannel || aiChannelSettings.channels.length === 0
  const [skillSearchQuery, setSkillSearchQuery] = useState('')
  const dedupedSkills = useMemo(() => {
    const skillMap = new Map<string, InstalledSkillSummary>()
    for (const skill of installedSkills) {
      const key = skill.skillId.trim().toLowerCase()
      if (!key || skillMap.has(key)) {
        continue
      }
      skillMap.set(key, skill)
    }
    return [...skillMap.values()]
  }, [installedSkills])
  const filteredSkills = useMemo(() => {
    const normalized = skillSearchQuery.trim().toLowerCase()
    if (!normalized) {
      return dedupedSkills
    }

    return dedupedSkills.filter((skill) =>
      [skill.skillId, skill.name, skill.description, skill.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(normalized)
    )
  }, [dedupedSkills, skillSearchQuery])

  return (
    <div className="rounded-[28px] border border-[#ececf0] bg-[#f7f7f9] px-5 py-4 shadow-[0_10px_30px_rgba(15,15,20,0.06)]">
      {pendingImages.length > 0 ? (
        <UserAttachmentGrid
          attachments={pendingImages.map((image) => ({
            id: image.id,
            fileName: image.fileName,
            width: image.width,
            height: image.height,
            sizeBytes: image.sizeBytes,
            src: image.previewUrl
          }))}
          allowRemove
          onRemove={onRemoveImage}
        />
      ) : null}
      {pendingPromptFile ? (
        <div className="mb-2 inline-flex max-w-full items-center gap-2 rounded-[16px] bg-[#1e2126] px-2.5 py-1.5 text-white shadow-[0_8px_24px_rgba(15,23,42,0.22)]">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-[10px] bg-[#1570ff] text-white">
            <FileCode2 className="h-4 w-4" />
          </span>
          <span className="max-w-[360px] truncate text-[13px] font-medium">
            {pendingPromptFile.fileName}
          </span>
          <button
            type="button"
            onClick={onRemovePromptFile}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-white/85 transition hover:bg-white/10 hover:text-white"
            aria-label="移除已上传文件"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onPaste={onPaste}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={isModelSwitcherDisabled}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-[#ececf1] px-2.5 pr-3 text-[12.5px] font-medium text-[#4e505a] transition hover:bg-[#e4e4eb] hover:text-[var(--ink-main)] disabled:cursor-not-allowed disabled:text-[#9ca0ad]"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[#8f919c]">
                  <Zap className="h-4 w-4" />
                </span>
                <span className="max-w-[220px] truncate">
                  {isAiChannelsLoading ? '加载模型中…' : activeChannelLabel}
                </span>
                {isSwitchingAiChannel ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[#737683]" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-[#737683]" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="top"
              className="w-[320px] rounded-2xl border border-[#e7e8ef] bg-white p-1.5 shadow-[0_18px_48px_rgba(15,15,20,0.14)]"
            >
              <DropdownMenuLabel className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                切换模型
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {aiChannelSettings.channels.length === 0 ? (
                <DropdownMenuItem disabled className="rounded-xl px-3 py-2 text-xs">
                  暂无可用模型，请先在设置中新增 Channel
                </DropdownMenuItem>
              ) : (
                <DropdownMenuRadioGroup
                  value={aiChannelSettings.activeChannelId ?? ''}
                  onValueChange={onActiveChannelChange}
                >
                  {aiChannelSettings.channels.map((channel) => (
                    <DropdownMenuRadioItem
                      key={channel.id}
                      value={channel.id}
                      className="rounded-xl py-2.5 pl-8 pr-3 data-[state=checked]:bg-accent/70"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-[13px] font-medium text-foreground">
                          {channel.model}
                        </span>
                        <span className="truncate text-[11px] text-muted-foreground">
                          {channel.name}
                        </span>
                      </div>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#ececf1] px-3.5 text-[12.5px] font-medium text-[#4e505a] transition hover:bg-[#e4e4eb] hover:text-[var(--ink-main)]"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[#8f919c]">
                  <Sparkles className="h-4 w-4" />
                </span>
                {selectedSkillIds.length > 0 ? `技能 ${selectedSkillIds.length}` : '技能'}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="top"
              className="w-[360px] rounded-2xl border border-[#e7e8ef] bg-white p-2 shadow-[0_18px_48px_rgba(15,15,20,0.14)]"
            >
              <div className="flex h-9 items-center gap-2 rounded-full bg-[#f3f3f6] px-3">
                <Search className="h-3.5 w-3.5 text-[#8c8f9c]" />
                <input
                  value={skillSearchQuery}
                  onChange={(event) => setSkillSearchQuery(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  placeholder="搜索技能"
                  className="w-full bg-transparent text-[13px] text-[#32343b] outline-none placeholder:text-[#9a9cab]"
                />
              </div>
              <div className="mt-2 max-h-[320px] overflow-y-auto rounded-xl border border-[#f0f1f4]">
                {isInstalledSkillsLoading ? (
                  <div className="px-3 py-4 text-[12px] text-[#8a8d99]">正在加载技能...</div>
                ) : filteredSkills.length === 0 ? (
                  <div className="px-3 py-4 text-[12px] text-[#8a8d99]">未找到匹配技能</div>
                ) : (
                  <ul className="divide-y divide-[#f0f1f4]">
                    {filteredSkills.map((skill) => {
                      const isSelected = selectedSkillIds.includes(skill.skillId)
                      return (
                        <li
                          key={skill.skillId}
                          className={`px-3 py-2.5 transition ${
                            isSelected ? 'bg-[#eef1ff]' : 'hover:bg-[#f7f7fa]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onToggleSkill(skill.skillId)}
                            className="flex w-full items-start gap-2 text-left"
                          >
                            <span className="mt-0.5 rounded-md bg-[#edf2ff] p-1 text-[#5b6ee1]">
                              <Sparkles className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0">
                              <div className="line-clamp-1 text-[14px] font-medium text-[#23242a]">
                                {skill.name}
                              </div>
                              <div className="line-clamp-1 text-[12px] text-[#7f828f]">
                                {skill.skillId}
                              </div>
                              <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[#5f626f]">
                                {skill.description}
                              </p>
                            </div>
                            <span
                              className={`mt-0.5 ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                                isSelected
                                  ? 'bg-[#5b6ee1] text-white'
                                  : 'border border-[#d8dbe7] text-transparent'
                              }`}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            onClick={onPickPromptFile}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#ececf1] px-3.5 text-[12.5px] font-medium text-[#4e505a] transition hover:bg-[#e4e4eb] hover:text-[var(--ink-main)]"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[#8f919c]">
              {/* <Upload className="h-4 w-4" /> */}
              <Link2 className="h-4 w-4" />
            </span>
            上传文件
          </button>
          {/* <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#ececf1] text-[#6d707c] transition hover:bg-[#e4e4eb] hover:text-[var(--ink-main)]"
            aria-label="关联内容"
          >
            <Link2 className="h-4 w-4" />
          </button> */}
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
            disabled={
              (!draft.trim() && pendingImages.length === 0 && !pendingPromptFile) ||
              isRunning ||
              !currentSessionId
            }
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#1f1f23] text-white transition hover:bg-[#2b2b31] disabled:cursor-not-allowed disabled:bg-[#e8e8ee] disabled:text-[#b8bac3]"
            aria-label="发送消息"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

const EmptyState = ({
  draft,
  pendingImages,
  pendingPromptFile,
  isRunning,
  isCancelling,
  currentSessionId,
  aiChannelSettings,
  installedSkills,
  selectedSkillIds,
  isAiChannelsLoading,
  isInstalledSkillsLoading,
  isSwitchingAiChannel,
  textareaRef,
  onDraftChange,
  onPaste,
  onRemoveImage,
  onToggleSkill,
  onActiveChannelChange,
  onPickPromptFile,
  onRemovePromptFile,
  onSend,
  onCancel
}: {
  draft: string
  pendingImages: PendingComposerImage[]
  pendingPromptFile: PendingPromptFile | null
  isRunning: boolean
  isCancelling: boolean
  currentSessionId: string | null
  aiChannelSettings: AiChannelSettings
  installedSkills: InstalledSkillSummary[]
  selectedSkillIds: string[]
  isAiChannelsLoading: boolean
  isInstalledSkillsLoading: boolean
  isSwitchingAiChannel: boolean
  textareaRef?: Ref<HTMLTextAreaElement>
  onDraftChange: (value: string) => void
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void
  onRemoveImage: (id: string) => void
  onToggleSkill: (skillId: string) => void
  onActiveChannelChange: (channelId: string) => void
  onPickPromptFile: () => void
  onRemovePromptFile: () => void
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
        pendingImages={pendingImages}
        pendingPromptFile={pendingPromptFile}
        isRunning={isRunning}
        isCancelling={isCancelling}
        currentSessionId={currentSessionId}
        aiChannelSettings={aiChannelSettings}
        installedSkills={installedSkills}
        selectedSkillIds={selectedSkillIds}
        isAiChannelsLoading={isAiChannelsLoading}
        isInstalledSkillsLoading={isInstalledSkillsLoading}
        isSwitchingAiChannel={isSwitchingAiChannel}
        textareaRef={textareaRef}
        onDraftChange={onDraftChange}
        onPaste={onPaste}
        onRemoveImage={onRemoveImage}
        onToggleSkill={onToggleSkill}
        onActiveChannelChange={onActiveChannelChange}
        onPickPromptFile={onPickPromptFile}
        onRemovePromptFile={onRemovePromptFile}
        onSend={onSend}
        onCancel={onCancel}
      />
    </div>
  </div>
)

export const ChatPage = () => {
  const AUTO_SCROLL_BOTTOM_THRESHOLD = 96
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [aiChannelSettings, setAiChannelSettings] = useState<AiChannelSettings>({
    channels: [],
    activeChannelId: null
  })
  const [installedSkills, setInstalledSkills] = useState<InstalledSkillSummary[]>([])
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [isAiChannelsLoading, setIsAiChannelsLoading] = useState(true)
  const [isInstalledSkillsLoading, setIsInstalledSkillsLoading] = useState(true)
  const [isSwitchingAiChannel, setIsSwitchingAiChannel] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [pendingImages, setPendingImages] = useState<PendingComposerImage[]>([])
  const [pendingPromptFile, setPendingPromptFile] = useState<PendingPromptFile | null>(null)
  const [isBooting, setIsBooting] = useState(true)
  const [bootError, setBootError] = useState<string | null>(null)
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [copiedAssistantId, setCopiedAssistantId] = useState<string | null>(null)
  const [resolvedAttachmentSrcById, setResolvedAttachmentSrcById] = useState<
    Record<string, string>
  >({})
  const [assistantFeedbackByKey, setAssistantFeedbackByKey] = useState<
    Record<string, AssistantFeedback>
  >({})
  const [selectedCanvasArtifactId, setSelectedCanvasArtifactId] = useState<string | null>(null)
  const [canvasPreviewHtml, setCanvasPreviewHtml] = useState('')
  const [canvasPreviewError, setCanvasPreviewError] = useState<string | null>(null)
  const [isCanvasPreviewLoading, setIsCanvasPreviewLoading] = useState(false)
  const [canvasViewport, setCanvasViewport] = useState<CanvasViewportMode>('desktop')
  const [isCanvasDialogOpen, setIsCanvasDialogOpen] = useState(false)
  const [canvasReloadNonce, setCanvasReloadNonce] = useState(0)
  const [state, dispatch] = useReducer(chatViewReducer, undefined, createInitialChatViewState)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const currentSessionIdRef = useRef<string | null>(null)
  const pendingImagesRef = useRef<PendingComposerImage[]>([])
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const shouldFocusComposerRef = useRef(false)
  const copyFeedbackTimeoutRef = useRef<number | null>(null)
  const shouldAutoScrollRef = useRef(true)
  const resolvedAttachmentAttemptedIdsRef = useRef<Set<string>>(new Set())
  const hasTranscript = state.transcript.length > 0

  const visibleSessions = useMemo(() => selectVisibleSessions(sessions), [sessions])
  const canvasArtifacts = useMemo(
    () => collectCanvasArtifacts(state.transcript),
    [state.transcript]
  )
  const latestCanvasArtifactId = canvasArtifacts.at(-1)?.artifact.id ?? null
  const activeCanvas = useMemo(
    () =>
      canvasArtifacts.find((item) => item.artifact.id === selectedCanvasArtifactId) ??
      canvasArtifacts.at(-1) ??
      null,
    [canvasArtifacts, selectedCanvasArtifactId]
  )
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
  const canvasIframeKey = useMemo(
    () =>
      activeCanvas
        ? `${activeCanvas.artifact.id}:${canvasReloadNonce}:${canvasViewport}`
        : 'canvas',
    [activeCanvas, canvasReloadNonce, canvasViewport]
  )
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId
  }, [currentSessionId])

  useEffect(() => {
    let disposed = false

    const loadAiChannels = async (): Promise<void> => {
      setIsAiChannelsLoading(true)

      try {
        const nextSettings = await window.context.getAiChannelSettings()
        if (!disposed) {
          setAiChannelSettings(nextSettings)
        }
      } catch (error) {
        if (!disposed) {
          toast.error(error instanceof Error ? error.message : 'Failed to load AI channels.')
        }
      } finally {
        if (!disposed) {
          setIsAiChannelsLoading(false)
        }
      }
    }

    void loadAiChannels()
    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    let disposed = false

    const loadInstalledSkills = async (): Promise<void> => {
      setIsInstalledSkillsLoading(true)

      try {
        const skills = await window.context.listInstalledSkills()
        const dedupedSkills = new Map<string, InstalledSkillSummary>()
        for (const skill of skills) {
          const key = skill.skillId.trim().toLowerCase()
          if (!key || dedupedSkills.has(key)) {
            continue
          }
          dedupedSkills.set(key, skill)
        }
        if (!disposed) {
          setInstalledSkills([...dedupedSkills.values()])
        }
      } catch (error) {
        if (!disposed) {
          toast.error(error instanceof Error ? error.message : 'Failed to load installed skills.')
        }
      } finally {
        if (!disposed) {
          setIsInstalledSkillsLoading(false)
        }
      }
    }

    void loadInstalledSkills()
    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    pendingImagesRef.current = pendingImages
    chatImageDebug('pendingImages updated', {
      count: pendingImages.length,
      images: pendingImages.map((image) => ({
        id: image.id,
        fileName: image.fileName,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        width: image.width,
        height: image.height
      }))
    })
  }, [pendingImages])

  useEffect(
    () => () => {
      if (copyFeedbackTimeoutRef.current) {
        window.clearTimeout(copyFeedbackTimeoutRef.current)
      }
      releasePendingImages(pendingImagesRef.current)
    },
    []
  )

  useEffect(() => {
    setCopiedAssistantId(null)
  }, [currentSessionId])

  useEffect(() => {
    setResolvedAttachmentSrcById({})
    resolvedAttachmentAttemptedIdsRef.current.clear()
    setSelectedSkillIds([])
    setSelectedCanvasArtifactId(null)
    setCanvasPreviewHtml('')
    setCanvasPreviewError(null)
    setCanvasReloadNonce(0)
    setCanvasViewport('desktop')
    setIsCanvasDialogOpen(false)
  }, [currentSessionId])

  useEffect(() => {
    setSelectedCanvasArtifactId(latestCanvasArtifactId)
  }, [latestCanvasArtifactId, currentSessionId])

  useEffect(() => {
    if (!activeCanvas) {
      setCanvasPreviewHtml('')
      setCanvasPreviewError(null)
      setIsCanvasPreviewLoading(false)
      return
    }

    let disposed = false
    setIsCanvasPreviewLoading(true)
    setCanvasPreviewError(null)

    const loadCanvasPreview = async (): Promise<void> => {
      try {
        const html = await window.context.readCanvasArtifactHtml({
          filePath: activeCanvas.artifact.filePath
        })
        if (disposed) {
          return
        }

        setCanvasPreviewHtml(html)
      } catch (error) {
        if (disposed) {
          return
        }

        setCanvasPreviewHtml('')
        setCanvasPreviewError(
          error instanceof Error ? error.message : 'Failed to load canvas preview.'
        )
      } finally {
        if (!disposed) {
          setIsCanvasPreviewLoading(false)
        }
      }
    }

    void loadCanvasPreview()
    return () => {
      disposed = true
    }
  }, [activeCanvas, canvasReloadNonce])

  useEffect(() => {
    if (pendingImagesRef.current.length === 0) {
      return
    }

    releasePendingImages(pendingImagesRef.current)
    setPendingImages([])
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
    const pendingAttachments = state.transcript
      .flatMap((entry) => (entry.kind === 'user' ? entry.attachments : []))
      .filter(
        (attachment) =>
          !resolvedAttachmentSrcById[attachment.id] &&
          !resolvedAttachmentAttemptedIdsRef.current.has(attachment.id)
      )

    if (pendingAttachments.length === 0) {
      return
    }

    for (const attachment of pendingAttachments) {
      resolvedAttachmentAttemptedIdsRef.current.add(attachment.id)
    }

    let disposed = false
    const resolveAttachments = async (): Promise<void> => {
      const resolvedEntries = await Promise.all(
        pendingAttachments.map(async (attachment) => ({
          id: attachment.id,
          src: await window.context.resolveChatAttachmentDataUrl(
            attachment.filePath,
            attachment.mimeType
          )
        }))
      )

      if (disposed) {
        return
      }

      const resolvedMap = resolvedEntries.reduce<Record<string, string>>((accumulator, item) => {
        if (item.src) {
          accumulator[item.id] = item.src
        }
        return accumulator
      }, {})

      if (Object.keys(resolvedMap).length === 0) {
        return
      }

      setResolvedAttachmentSrcById((current) => ({ ...current, ...resolvedMap }))
    }

    void resolveAttachments()
    return () => {
      disposed = true
    }
  }, [resolvedAttachmentSrcById, state.transcript])

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

      const userMessageAttachments =
        event.type === 'user.message' ? (event.attachments ?? []) : undefined

      chatImageDebug('chat event received', {
        sessionId: currentSessionId,
        type: event.type,
        attachmentCount: userMessageAttachments?.length,
        attachmentNames: userMessageAttachments?.map((attachment) => attachment.fileName)
      })

      dispatch({ type: 'event.received', event })

      if (
        event.type === 'user.message' ||
        event.type === 'assistant.completed' ||
        event.type === 'session.title.updated' ||
        event.type === 'session.error' ||
        event.type === 'session.cancelled' ||
        event.type === 'cron.delivery'
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

  const removePendingImage = (imageId: string): void => {
    setPendingImages((current) => {
      const target = current.find((image) => image.id === imageId)
      if (target?.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl)
      }

      return current.filter((image) => image.id !== imageId)
    })
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
    attachments: PendingComposerImage[],
    skills: string[],
    options?: { clearComposer?: boolean; pendingPromptFile?: PendingPromptFile | null }
  ): Promise<void> => {
    const promptWithFile = options?.pendingPromptFile
      ? prependPromptFilePath(message, options.pendingPromptFile.filePath)
      : message

    if ((!promptWithFile.trim() && attachments.length === 0) || state.isRunning) return

    chatImageDebug('sendMessage request', {
      sessionId,
      textLength: promptWithFile.length,
      attachmentCount: attachments.length,
      skillCount: skills.length,
      skills,
      promptFilePath: options?.pendingPromptFile?.filePath ?? null,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        width: attachment.width,
        height: attachment.height
      }))
    })

    if (options?.clearComposer) {
      setDraft('')
      setPendingImages([])
      setPendingPromptFile(null)
    }

    dispatch({ type: 'run.requested' })

    try {
      await window.context.sendMessage(sessionId, {
        text: promptWithFile,
        skills,
        attachments: attachments.map(({ id, fileName, mimeType, dataBase64, sizeBytes }) => ({
          id,
          fileName,
          mimeType,
          dataBase64,
          sizeBytes
        }))
      })

      chatImageDebug('sendMessage resolved', {
        sessionId,
        attachmentCount: attachments.length
      })

      // Re-sync from persisted events after the turn settles in main process.
      // This prevents UI from getting stuck in "running" if any live IPC event was missed.
      const snapshot = await window.context.openSession(sessionId)
      if (currentSessionIdRef.current === sessionId) {
        chatImageDebug('session snapshot reloaded', {
          sessionId,
          eventCount: snapshot.events.length
        })
        dispatch({ type: 'snapshot.loaded', snapshot })
      }
      releasePendingImages(attachments)
    } catch (error) {
      chatImageDebug('sendMessage failed', {
        sessionId,
        attachmentCount: attachments.length,
        error
      })
      if (options?.clearComposer) {
        setDraft(message)
        setPendingImages(attachments)
        setPendingPromptFile(options.pendingPromptFile ?? null)
      }

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
    await runMessage(currentSessionId, draft, pendingImages, selectedSkillIds, {
      clearComposer: true,
      pendingPromptFile
    })
  }

  const handlePickPromptFile = async (): Promise<void> => {
    try {
      const filePath = await window.context.pickPromptFilePath()
      if (!filePath) {
        return
      }

      setPendingPromptFile({
        filePath,
        fileName: getFileNameFromPath(filePath)
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '选择文件失败，请重试。')
    }
  }

  const handleRemovePromptFile = (): void => {
    setPendingPromptFile(null)
  }

  const insertTextAtComposerSelection = (text: string): void => {
    if (!text) return

    const composer = composerRef.current
    if (!composer) {
      setDraft((current) => `${current}${text}`)
      return
    }

    const selectionStart = composer.selectionStart ?? composer.value.length
    const selectionEnd = composer.selectionEnd ?? composer.value.length
    const next = `${draft.slice(0, selectionStart)}${text}${draft.slice(selectionEnd)}`
    const nextCaret = selectionStart + text.length

    setDraft(next)
    requestAnimationFrame(() => {
      composer.focus()
      composer.setSelectionRange(nextCaret, nextCaret)
    })
  }

  const handleComposerPaste = async (event: ClipboardEvent<HTMLTextAreaElement>): Promise<void> => {
    const imageItems = Array.from(event.clipboardData.items).filter(
      (item) => item.kind === 'file' && item.type.startsWith('image/')
    )
    if (imageItems.length === 0) {
      return
    }

    event.preventDefault()

    const pastedText = event.clipboardData.getData('text/plain')
    if (pastedText) {
      insertTextAtComposerSelection(pastedText)
    }

    if (pendingImages.length >= MAX_PENDING_IMAGES) {
      toast.error(`最多只能添加 ${MAX_PENDING_IMAGES} 张图片`)
      return
    }

    const availableSlots = MAX_PENDING_IMAGES - pendingImages.length
    const acceptedItems = imageItems.slice(0, availableSlots)
    if (acceptedItems.length < imageItems.length) {
      toast.error(`最多只能添加 ${MAX_PENDING_IMAGES} 张图片`)
    }

    let nextImages: Array<PendingComposerImage | null> = []

    try {
      nextImages = (
        await Promise.all(
          acceptedItems.map(async (item, index) => {
            const file = item.getAsFile()
            if (!file) {
              return null
            }

            if (!SUPPORTED_CHAT_IMAGE_TYPES.has(file.type as ChatImageAttachment['mimeType'])) {
              toast.error(`不支持的图片格式：${file.type || 'unknown'}`)
              return null
            }

            if (file.size > MAX_PENDING_IMAGE_BYTES) {
              toast.error(`${file.name || `图片 ${index + 1}`} 超过 8 MB 限制`)
              return null
            }

            const dataUrl = await readFileAsDataUrl(file)
            const [, dataBase64 = ''] = dataUrl.split(',', 2)
            const dimensions = await readImageDimensionsSafely(dataUrl)
            const mimeType = file.type as ChatImageAttachment['mimeType']
            const fallbackName = `pasted-image-${Date.now()}-${index + 1}.${MIME_TO_EXTENSION[mimeType]}`

            return {
              id: crypto.randomUUID(),
              fileName: file.name || fallbackName,
              mimeType,
              dataBase64,
              sizeBytes: file.size,
              width: dimensions.width,
              height: dimensions.height,
              previewUrl: dataUrl
            } satisfies PendingComposerImage
          })
        )
      ).filter(Boolean) as PendingComposerImage[]
    } catch (error) {
      toast.error(mapSendErrorMessage(error))
      return
    }

    if (nextImages.length > 0) {
      setPendingImages((current) => [
        ...current,
        ...(nextImages.filter(Boolean) as PendingComposerImage[])
      ])
    }
  }

  const handleComposerPasteWithFallback = async (
    event: ClipboardEvent<HTMLTextAreaElement>
  ): Promise<void> => {
    const imageItems = Array.from(event.clipboardData.items).filter(
      (item) => item.kind === 'file' && item.type.startsWith('image/')
    )
    const pastedText = event.clipboardData.getData('text/plain')
    const hasDomImageItems = imageItems.length > 0

    chatImageDebug('paste detected', {
      hasDomImageItems,
      domImageItemCount: imageItems.length,
      clipboardItemTypes: Array.from(event.clipboardData.items).map((item) => ({
        kind: item.kind,
        type: item.type
      })),
      pastedTextLength: pastedText.length
    })

    if (pendingImages.length >= MAX_PENDING_IMAGES) {
      if (hasDomImageItems) {
        event.preventDefault()
      }
      toast.error(`You can attach up to ${MAX_PENDING_IMAGES} images.`)
      return
    }

    const availableSlots = MAX_PENDING_IMAGES - pendingImages.length
    const nextImages: PendingComposerImage[] = []

    if (hasDomImageItems) {
      event.preventDefault()

      if (pastedText) {
        insertTextAtComposerSelection(pastedText)
      }

      const acceptedItems = imageItems.slice(0, availableSlots)
      if (acceptedItems.length < imageItems.length) {
        toast.error(`You can attach up to ${MAX_PENDING_IMAGES} images.`)
      }

      try {
        const domImages = await Promise.all(
          acceptedItems.map(async (item, index) => {
            const file = item.getAsFile()
            if (!file) {
              return null
            }

            if (!SUPPORTED_CHAT_IMAGE_TYPES.has(file.type as ChatImageAttachment['mimeType'])) {
              toast.error(`Unsupported image format: ${file.type || 'unknown'}`)
              return null
            }

            if (file.size > MAX_PENDING_IMAGE_BYTES) {
              toast.error(`${file.name || `Image ${index + 1}`} exceeds the 8 MB limit.`)
              return null
            }

            const dataUrl = await readFileAsDataUrl(file)
            const [, dataBase64 = ''] = dataUrl.split(',', 2)
            const dimensions = await readImageDimensionsSafely(dataUrl)
            const mimeType = file.type as ChatImageAttachment['mimeType']
            const fallbackName = `pasted-image-${Date.now()}-${index + 1}.${MIME_TO_EXTENSION[mimeType]}`

            return {
              id: crypto.randomUUID(),
              fileName: file.name || fallbackName,
              mimeType,
              dataBase64,
              sizeBytes: file.size,
              width: dimensions.width,
              height: dimensions.height,
              previewUrl: dataUrl
            } satisfies PendingComposerImage
          })
        )

        const acceptedDomImages = domImages.filter(Boolean) as PendingComposerImage[]
        chatImageDebug('paste resolved from DOM clipboardData', {
          attachmentCount: acceptedDomImages.length,
          attachments: acceptedDomImages.map((image) => ({
            fileName: image.fileName,
            mimeType: image.mimeType,
            sizeBytes: image.sizeBytes,
            width: image.width,
            height: image.height
          }))
        })
        nextImages.push(...acceptedDomImages)
      } catch (error) {
        chatImageDebug('paste failed while reading DOM clipboardData', { error })
        toast.error(mapSendErrorMessage(error))
        return
      }
    } else {
      let clipboardImage: ClipboardImagePayload | null = null

      chatImageDebug('paste falling back to Electron clipboard')

      try {
        clipboardImage = await window.context.readClipboardImage()
      } catch (error) {
        chatImageDebug('Electron clipboard read failed', { error })
        toast.error(mapSendErrorMessage(error))
        return
      }

      if (!clipboardImage) {
        chatImageDebug('Electron clipboard has no image')
        return
      }

      chatImageDebug('Electron clipboard returned image', {
        mimeType: clipboardImage.mimeType,
        sizeBytes: clipboardImage.sizeBytes,
        width: clipboardImage.width,
        height: clipboardImage.height
      })

      try {
        const nextImage = await buildPendingImageFromClipboardPayload(clipboardImage)
        chatImageDebug('paste resolved from Electron clipboard', {
          fileName: nextImage.fileName,
          mimeType: nextImage.mimeType,
          sizeBytes: nextImage.sizeBytes,
          width: nextImage.width,
          height: nextImage.height
        })
        nextImages.push(nextImage)
      } catch (error) {
        chatImageDebug('paste failed while normalizing Electron clipboard image', { error })
        toast.error(mapSendErrorMessage(error))
        return
      }
    }

    if (nextImages.length > 0) {
      setPendingImages((current) => [...current, ...nextImages])
    }
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

  const handleFeedback = (
    assistantMessageId: string,
    value: Exclude<AssistantFeedback, null>
  ): void => {
    if (!currentSessionId) return

    const key = buildFeedbackKey(currentSessionId, assistantMessageId)
    setAssistantFeedbackByKey((prev) => toggleAssistantFeedback(prev, key, value))
  }

  const handleRetryLatestAssistant = async (): Promise<void> => {
    if (!currentSessionId || !latestAssistantMessageId) return

    const prompt =
      retryPrompt ?? getRetryPromptForAssistant(state.transcript, latestAssistantMessageId)
    if (!prompt) return

    await runMessage(currentSessionId, prompt, [], selectedSkillIds)
  }

  const toggleSkillSelection = (skillId: string): void => {
    const normalized = skillId.trim()
    if (!normalized) {
      return
    }

    setSelectedSkillIds((current) =>
      current.includes(normalized)
        ? current.filter((item) => item !== normalized)
        : [...current, normalized]
    )
  }

  const handleCancel = async (): Promise<void> => {
    if (!currentSessionId || !state.isRunning) return
    dispatch({ type: 'cancel.requested' })
    await window.context.cancelRun(currentSessionId)
  }

  const handleActiveChannelChange = async (channelId: string): Promise<void> => {
    if (!channelId || channelId === aiChannelSettings.activeChannelId) {
      return
    }

    setIsSwitchingAiChannel(true)

    try {
      const nextSettings = await window.context.setActiveAiChannel(channelId)
      setAiChannelSettings(nextSettings)
      toast.success('Switched active AI channel.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to switch AI channel.')
    } finally {
      setIsSwitchingAiChannel(false)
    }
  }

  const resolveUserAttachmentSrc = (attachment: ChatImageAttachment): string =>
    resolvedAttachmentSrcById[attachment.id] ?? toFileSrc(attachment.filePath)

  const handlePreviewCanvas = (artifact: ChatCanvasArtifact): void => {
    setSelectedCanvasArtifactId(artifact.id)
    setCanvasPreviewError(null)
    if (window.innerWidth < 1280) {
      setIsCanvasDialogOpen(true)
    }
  }

  const handleReloadCanvas = (): void => {
    setCanvasReloadNonce((current) => current + 1)
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

      <section className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--content-bg)]">
        <div
          className={`flex min-h-0 min-w-0 flex-col overflow-hidden ${
            activeCanvas ? 'xl:w-1/2 xl:basis-1/2 xl:shrink-0' : 'flex-1'
          }`}
        >
          <div
            ref={transcriptRef}
            className={`min-h-0 flex-1 overflow-y-auto px-2 ${hasTranscript ? 'pb-2' : ''}`}
          >
            {isBooting ? (
              <div className="flex h-full items-center justify-center text-[14px] text-[var(--ink-soft)]">
                正在加载会话…
              </div>
            ) : bootError ? (
              <BootErrorState message={bootError} />
            ) : hasTranscript ? (
              <div className="mx-auto flex w-full max-w-[860px] flex-col gap-6 px-6 py-6">
                {activeCanvas ? (
                  <div className="flex justify-end xl:hidden">
                    <button
                      type="button"
                      onClick={() => setIsCanvasDialogOpen(true)}
                      className="inline-flex items-center gap-2 rounded-full border border-[var(--border-soft)] bg-white px-4 py-2 text-[12px] font-semibold text-[var(--ink-main)] shadow-[0_8px_24px_rgba(15,23,42,0.08)] transition hover:bg-[#f3f3f6]"
                    >
                      <PanelRightOpen className="h-4 w-4" />
                      {activeCanvas.artifact.title}
                    </button>
                  </div>
                ) : null}

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
                      feedback={feedbackKey ? (assistantFeedbackByKey[feedbackKey] ?? null) : null}
                      disableRetry={!retryPrompt || state.isRunning}
                      activeCanvasArtifactId={activeCanvas?.artifact.id ?? null}
                      resolveUserAttachmentSrc={resolveUserAttachmentSrc}
                      onPreviewCanvas={handlePreviewCanvas}
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
                pendingImages={pendingImages}
                pendingPromptFile={pendingPromptFile}
                isRunning={state.isRunning}
                isCancelling={state.isCancelling}
                currentSessionId={currentSessionId}
                aiChannelSettings={aiChannelSettings}
                installedSkills={installedSkills}
                selectedSkillIds={selectedSkillIds}
                isAiChannelsLoading={isAiChannelsLoading}
                isInstalledSkillsLoading={isInstalledSkillsLoading}
                isSwitchingAiChannel={isSwitchingAiChannel}
                textareaRef={composerRef}
                onDraftChange={setDraft}
                onPaste={(event) => void handleComposerPasteWithFallback(event)}
                onRemoveImage={removePendingImage}
                onToggleSkill={toggleSkillSelection}
                onActiveChannelChange={(channelId) => void handleActiveChannelChange(channelId)}
                onPickPromptFile={() => void handlePickPromptFile()}
                onRemovePromptFile={handleRemovePromptFile}
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
                  pendingImages={pendingImages}
                  pendingPromptFile={pendingPromptFile}
                  isRunning={state.isRunning}
                  isCancelling={state.isCancelling}
                  currentSessionId={currentSessionId}
                  aiChannelSettings={aiChannelSettings}
                  installedSkills={installedSkills}
                  selectedSkillIds={selectedSkillIds}
                  isAiChannelsLoading={isAiChannelsLoading}
                  isInstalledSkillsLoading={isInstalledSkillsLoading}
                  isSwitchingAiChannel={isSwitchingAiChannel}
                  textareaRef={composerRef}
                  onDraftChange={setDraft}
                  onPaste={(event) => void handleComposerPasteWithFallback(event)}
                  onRemoveImage={removePendingImage}
                  onToggleSkill={toggleSkillSelection}
                  onActiveChannelChange={(channelId) => void handleActiveChannelChange(channelId)}
                  onPickPromptFile={() => void handlePickPromptFile()}
                  onRemovePromptFile={handleRemovePromptFile}
                  onSend={() => void handleSend()}
                  onCancel={() => void handleCancel()}
                />
              </div>
            </div>
          ) : null}
        </div>

        {activeCanvas ? (
          <aside className="hidden min-w-0 border-l border-[var(--border-soft)] xl:block xl:w-1/2 xl:basis-1/2 xl:shrink-0">
            <CanvasPage
              activeCanvas={activeCanvas}
              html={canvasPreviewHtml}
              isLoading={isCanvasPreviewLoading}
              error={canvasPreviewError}
              viewport={canvasViewport}
              iframeKey={canvasIframeKey}
              onViewportChange={setCanvasViewport}
              onReload={handleReloadCanvas}
            />
          </aside>
        ) : null}
      </section>

      {activeCanvas ? (
        <Dialog open={isCanvasDialogOpen} onOpenChange={setIsCanvasDialogOpen}>
          <DialogContent className="max-w-[min(1000px,96vw)] border-none bg-transparent p-0 shadow-none">
            <DialogHeader className="sr-only">
              <DialogTitle>{activeCanvas.artifact.title}</DialogTitle>
              <DialogDescription>
                Preview generated HTML content inside a sandboxed iframe.
              </DialogDescription>
            </DialogHeader>
            <div className="h-[85vh] overflow-hidden rounded-[32px] border border-[var(--border-soft)] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] xl:hidden">
              <CanvasPage
                activeCanvas={activeCanvas}
                html={canvasPreviewHtml}
                isLoading={isCanvasPreviewLoading}
                error={canvasPreviewError}
                viewport={canvasViewport}
                iframeKey={canvasIframeKey}
                onViewportChange={setCanvasViewport}
                onReload={handleReloadCanvas}
              />
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
