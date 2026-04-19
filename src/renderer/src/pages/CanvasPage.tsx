import type { ChatCanvasArtifact } from '@shared/models'
import { FileCode2, Monitor, RefreshCw, Smartphone } from 'lucide-react'

export type CanvasViewportMode = 'desktop' | 'mobile'

export type CanvasArtifactView = {
  artifact: ChatCanvasArtifact
  toolCallId: string
  toolName: string
  outputSummary: string
  assistantMessageId: string
  timestamp: number
}

const formatClockTime = (timestamp: number): string =>
  new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(timestamp)

interface CanvasPageProps {
  activeCanvas: CanvasArtifactView | null
  html: string
  isLoading: boolean
  error: string | null
  viewport: CanvasViewportMode
  iframeKey: string
  onViewportChange: (viewport: CanvasViewportMode) => void
  onReload: () => void
}

export const CanvasPage = ({
  activeCanvas,
  html,
  isLoading,
  error,
  viewport,
  iframeKey,
  onViewportChange,
  onReload
}: CanvasPageProps) => {
  const frameWidthClassName = viewport === 'mobile' ? 'mx-auto w-[390px] max-w-full' : 'w-full'

  return (
    <div className="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,246,249,0.96))]">
      <div className="border-b border-[var(--border-soft)] px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-faint)]">
              <FileCode2 className="h-4 w-4" />
              Canvas
            </div>
            <div className="mt-2 truncate text-[17px] font-semibold text-[var(--ink-main)]">
              {activeCanvas?.artifact.title ?? 'No canvas selected'}
            </div>
            <div className="mt-1 text-[12px] text-[var(--ink-soft)]">
              {activeCanvas
                ? `${activeCanvas.toolName} · ${formatClockTime(activeCanvas.timestamp)}`
                : 'Run the canvas tool to preview generated HTML here.'}
            </div>
          </div>

          <button
            type="button"
            onClick={onReload}
            disabled={!activeCanvas || isLoading}
            className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-[var(--border-soft)] bg-white text-[var(--ink-subtle)] transition hover:bg-[#f1f1f4] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Reload canvas preview"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {activeCanvas ? (
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => onViewportChange('desktop')}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium transition ${
                viewport === 'desktop'
                  ? 'bg-[var(--ink-main)] text-white'
                  : 'bg-white text-[var(--ink-subtle)] hover:bg-[#f1f1f4]'
              }`}
            >
              <Monitor className="h-3.5 w-3.5" />
              Desktop
            </button>
            <button
              type="button"
              onClick={() => onViewportChange('mobile')}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium transition ${
                viewport === 'mobile'
                  ? 'bg-[var(--ink-main)] text-white'
                  : 'bg-white text-[var(--ink-subtle)] hover:bg-[#f1f1f4]'
              }`}
            >
              <Smartphone className="h-3.5 w-3.5" />
              Mobile
            </button>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 p-4">
        {!activeCanvas ? (
          <div className="flex h-full min-h-[320px] items-center justify-center rounded-[28px] border border-dashed border-[var(--border-soft)] bg-white/75 px-6 text-center text-[13px] leading-6 text-[var(--ink-soft)]">
            The latest HTML canvas artifact will appear here.
          </div>
        ) : isLoading ? (
          <div className="flex h-full min-h-[320px] items-center justify-center rounded-[28px] border border-[var(--border-soft)] bg-white/80 text-[13px] text-[var(--ink-soft)]">
            Loading canvas preview…
          </div>
        ) : error ? (
          <div className="rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 text-[13px] leading-6 text-rose-700">
            {error}
          </div>
        ) : (
          <div className={`${frameWidthClassName} h-full min-h-0`}>
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-[var(--border-soft)] bg-white shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
              <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-[var(--ink-faint)]">
                <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
                <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#f97316]" />
                <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#10b981]" />
                <span className="ml-2 truncate">{activeCanvas.artifact.fileName}</span>
              </div>
              <iframe
                key={iframeKey}
                title={activeCanvas.artifact.title}
                sandbox="allow-scripts"
                srcDoc={html}
                className="min-h-0 flex-1 w-full bg-white"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
