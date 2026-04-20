import type {
    ChatCanvasArtifact,
    ChatEvent,
    ChatImageAttachment,
    NoteContent,
    NoteInfo,
    SessionMeta,
    SessionSnapshot
} from './models';

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
export type PendingImageAttachment = Omit<
  ChatImageAttachment,
  'filePath' | 'sizeBytes' | 'width' | 'height'
> & {
  dataBase64: string
  sizeBytes?: number
}
export interface SendMessageInput {
  text: string
  attachments: PendingImageAttachment[]
  skills?: string[]
}
export type SendMessage = (sessionId: string, input: SendMessageInput) => Promise<void>
export interface ClipboardImagePayload {
  mimeType: ChatImageAttachment['mimeType']
  dataBase64: string
  sizeBytes: number
  width: number
  height: number
}
export type ReadClipboardImage = () => Promise<ClipboardImagePayload | null>
export type PickPromptFilePath = () => Promise<string | null>
export type ResolveChatAttachmentDataUrl = (
  filePath: string,
  mimeType: ChatImageAttachment['mimeType']
) => Promise<string | null>
export type ReadCanvasArtifactHtml = (
  artifact: Pick<ChatCanvasArtifact, 'filePath'>
) => Promise<string>
export type CancelRun = (sessionId: string) => Promise<void>

export type CronScheduleKind = 'delay' | 'interval' | 'cron' | 'datetime'
export type CronJobState = 'scheduled' | 'paused' | 'running' | 'completed'
export type CronRunStatus = 'running' | 'success' | 'error'
export type CronRunTriggerKind = 'scheduled' | 'manual' | 'recovered'
export type CronDeliverTarget = 'origin_session' | 'local_file'
export type CronMisfirePolicy = 'run_once_on_resume'

export interface CronJob {
  id: string
  name: string
  prompt: string
  schedule: string
  scheduleKind: CronScheduleKind
  timezone: string | null
  state: CronJobState
  nextRunAt: number | null
  lastRunAt: number | null
  sourceSessionId: string | null
  deliver: CronDeliverTarget
  skills: string[]
  script: string | null
  runCount: number
  maxRuns: number | null
  misfirePolicy: CronMisfirePolicy
  createdAt: number
  updatedAt: number
}

export interface CronRun {
  id: string
  jobId: string
  triggerKind: CronRunTriggerKind
  status: CronRunStatus
  startedAt: number
  finishedAt: number | null
  linkedSessionId: string | null
  outputPreview: string
  outputPath: string | null
  errorText: string | null
  model: string | null
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  nextRunAt: number | null
}

export interface CreateCronJobInput {
  name: string
  prompt: string
  schedule: string
  timezone?: string | null
  deliver?: CronDeliverTarget
  skills?: string[]
  script?: string | null
  maxRuns?: number | null
  sourceSessionId?: string | null
}

export interface UpdateCronJobInput {
  name?: string
  prompt?: string
  schedule?: string
  timezone?: string | null
  deliver?: CronDeliverTarget
  skills?: string[]
  script?: string | null
  maxRuns?: number | null
}

export type ListCronJobs = () => Promise<CronJob[]>
export type ListCronRuns = (limit?: number) => Promise<CronRun[]>
export type CreateCronJob = (input: CreateCronJobInput) => Promise<CronJob>
export type UpdateCronJob = (jobId: string, input: UpdateCronJobInput) => Promise<CronJob>
export type PauseCronJob = (jobId: string) => Promise<CronJob>
export type ResumeCronJob = (jobId: string) => Promise<CronJob>
export type RemoveCronJob = (jobId: string) => Promise<void>
export type RunCronJob = (jobId: string) => Promise<CronRun>

export type ChatListener = (event: ChatEvent) => void
export type Unsubscribe = () => void
export type SubscribeChatEvents = (sessionId: string, listener: ChatListener) => Unsubscribe

export type WindowMinimize = () => Promise<void>
export type WindowIsMaximized = () => Promise<boolean>
export type WindowToggleMaximize = () => Promise<void>
export type WindowClose = () => Promise<void>

export interface AiChannelConfig {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
}

export interface AiChannelSettings {
  channels: AiChannelConfig[]
  activeChannelId: string | null
}

export interface ConnectionCheckResult {
  provider: string
  model: string
  baseUrl?: string
  latencyMs: number
  preview: string
}

export interface WeixinGatewayAccount {
  accountId: string
  baseUrl: string
  token: string
  routeTag: string
  channelVersion: string
  enabled: boolean
  connectedAt: number
}

export interface WeixinQrStartResult {
  sessionKey: string
  qrCodeUrl: string | null
  message: string
}

export interface WeixinQrWaitResult {
  connected: boolean
  accountId: string | null
  baseUrl: string | null
  token: string | null
  userId: string | null
  message: string
}

export type UsageRecordKind = 'chat_turn' | 'title_gen' | 'connection_test' | 'session_memory'

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
  errorCode?: string
  errorType?: string
  failureStage?: string
  validationStatus?: 'skipped' | 'passed' | 'failed_schema' | 'failed_semantic'
  attemptCount?: number
  retryCount?: number
  selfHealCount?: number
  fallbackUsed?: boolean
  fallbackStrategy?: string
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

export interface InstalledSkillSummary {
  skillId: string
  name: string
  description: string
  tags: string[]
}

export type GetAiChannelSettings = () => Promise<AiChannelSettings>
export type SaveAiChannelSettings = (settings: AiChannelSettings) => Promise<AiChannelSettings>
export type SetActiveAiChannel = (
  channelId: AiChannelConfig['id'] | null
) => Promise<AiChannelSettings>
export type TestAiChannelConnection = (channel: AiChannelConfig) => Promise<ConnectionCheckResult>
export type ListWeixinGatewayAccounts = () => Promise<WeixinGatewayAccount[]>
export type StartWeixinQrLogin = (input?: {
  accountId?: string
  force?: boolean
  timeoutMs?: number
}) => Promise<WeixinQrStartResult>
export type WaitWeixinQrLogin = (input: {
  sessionKey: string
  timeoutMs?: number
}) => Promise<WeixinQrWaitResult>
export type DisconnectWeixinGatewayAccount = (accountId: string) => Promise<void>
export type GetWeixinGatewayHealth = () => Promise<
  Array<{
    accountId: string
    status: 'idle' | 'running' | 'paused' | 'error' | 'stopped'
    lastEventAt: number | null
    lastInboundAt: number | null
    lastError: string | null
    consecutiveFailures: number
    pausedUntil: number | null
  }>
>
export type GetUsageOverview = () => Promise<UsageOverview>
export type ListUsageRecords = (limit?: number) => Promise<UsageRecord[]>
export type ListToolCallRecords = (limit?: number) => Promise<ToolCallUsageRecord[]>
export type ListToolStats = (limit?: number) => Promise<ToolStatsRecord[]>
export type ListSkillUsageRecords = (limit?: number) => Promise<SkillUsageRecord[]>
export type ListInstalledSkills = () => Promise<InstalledSkillSummary[]>
export interface SearchSkillsOptions {
  searchUrl?: string
  limit?: number
  timeoutMs?: number
}
export interface InstallSkillOptions {
  installRoot?: string
  force?: boolean
  primaryDownloadUrlTemplate?: string
  searchUrl?: string
  searchLimit?: number
  searchTimeoutMs?: number
}
export interface SkillSearchResult {
  slug: string
  name: string
  description: string
  summary: string
  version: string
}
export type SearchSkills = (
  query: string,
  options?: SearchSkillsOptions
) => Promise<{ query: string; count: number; results: SkillSearchResult[] }>
export type InstallSkill = (
  slug: string,
  options?: InstallSkillOptions
) => Promise<{ success: boolean; slug: string; targetDir: string; version?: string; error?: string }>
export interface SkillHubCnSkill {
  category: string
  created_at: number
  description: string
  description_zh: string
  downloads: number
  homepage: string
  iconUrl: string | null
  installs: number
  name: string
  ownerName: string
  score: number
  slug: string
  source: string
  stars: number
  tags: string[] | null
  updated_at: number
  version: string
}
export type ListSkills = (
  page?: number,
  pageSize?: number,
  options?: { category?: string; keyword?: string; sortBy?: string; order?: string }
) => Promise<{ skills: SkillHubCnSkill[]; total: number }>
