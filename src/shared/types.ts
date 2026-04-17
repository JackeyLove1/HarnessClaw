import type { ChatEvent, NoteContent, NoteInfo, SessionMeta, SessionSnapshot } from './models'

export type GetNotes = () => Promise<NoteInfo[]>
export type ReadNote = (title: NoteInfo['title']) => Promise<NoteContent>
export type WriteNote = (title: NoteInfo['title'], content: NoteContent) => Promise<void>
export type CreateNote = () => Promise<NoteInfo['title'] | false>
export type DeleteNote = (title: NoteInfo['title']) => Promise<boolean>

export type ListSessions = () => Promise<SessionMeta[]>
export type SearchSessions = (query: string) => Promise<SessionMeta[]>
export type CreateSession = () => Promise<SessionMeta>
export type OpenSession = (sessionId: string) => Promise<SessionSnapshot>
export type UpdateSessionTitle = (sessionId: string, title: string) => Promise<SessionMeta>
export type DeleteSession = (sessionId: string) => Promise<void>
export type SendMessage = (sessionId: string, text: string) => Promise<void>
export type CancelRun = (sessionId: string) => Promise<void>

export type ChatListener = (event: ChatEvent) => void
export type Unsubscribe = () => void
export type SubscribeChatEvents = (sessionId: string, listener: ChatListener) => Unsubscribe

export type WindowMinimize = () => Promise<void>
export type WindowIsMaximized = () => Promise<boolean>
export type WindowToggleMaximize = () => Promise<void>
export type WindowClose = () => Promise<void>

export interface AnthropicSettings {
  baseUrl: string
  apiKey: string
  model: string
}

export interface ConnectionCheckResult {
  provider: string
  model: string
  baseUrl?: string
  latencyMs: number
  preview: string
}

export type UsageRecordKind = 'chat_turn' | 'title_gen' | 'connection_test'

export interface UsageOverview {
  todayTokenUsage: number
  todayInputTokens: number
  todayOutputTokens: number
  todayCacheCreationTokens: number
  todayCacheReadTokens: number
  remainingTokens: number | null
  totalSessions: number
  totalMessages: number
}

export interface UsageRecord {
  id: string
  sessionId: string | null
  sessionTitle: string | null
  assistantMessageId: string | null
  requestRound: number
  kind: UsageRecordKind
  model: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalTokens: number
  timestamp: number
}

export interface ToolCallUsageRecord {
  eventId: string
  sessionId: string
  sessionTitle: string | null
  timestamp: number
  toolName: string
  callType: 'tool' | 'mcp'
  phase: 'called' | 'completed'
  status: 'running' | 'success' | 'error'
  durationMs: number | null
  argsSummary: string
  outputSummary: string
}

export interface ToolStatsRecord {
  toolName: string
  callType: 'tool' | 'mcp'
  basePriority: number
  effectivePriority: number
  useCount: number
  successCount: number
  errorCount: number
  totalDurationMs: number
  averageDurationMs: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheCreationTokens: number
  totalCacheReadTokens: number
  totalTokens: number
  lastUsedAt: number | null
}

export interface SkillUsageRecord {
  id: string
  sessionId: string | null
  sessionTitle: string | null
  assistantMessageId: string
  requestRound: number
  toolCallId: string
  skillId: string
  skillName: string
  skillFilePath: string
  timestamp: number
}

export type GetAnthropicSettings = () => Promise<AnthropicSettings>
export type SaveAnthropicSettings = (settings: AnthropicSettings) => Promise<AnthropicSettings>
export type TestAnthropicConnection = (
  settings: AnthropicSettings
) => Promise<ConnectionCheckResult>
export type GetUsageOverview = () => Promise<UsageOverview>
export type ListUsageRecords = (limit?: number) => Promise<UsageRecord[]>
export type ListToolCallRecords = (limit?: number) => Promise<ToolCallUsageRecord[]>
export type ListToolStats = (limit?: number) => Promise<ToolStatsRecord[]>
export type ListSkillUsageRecords = (limit?: number) => Promise<SkillUsageRecord[]>
