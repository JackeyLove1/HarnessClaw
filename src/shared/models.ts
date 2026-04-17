export type NoteInfo = {
  title: string
  lastEditTime: number
}

export type NoteContent = string

export type SessionStatus = 'idle' | 'running' | 'error' | 'cancelled'

export type SessionMeta = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  status: SessionStatus
}

export type ChatEventBase = {
  eventId: string
  sessionId: string
  timestamp: number
}

export type SessionCreatedEvent = ChatEventBase & {
  type: 'session.created'
  meta: SessionMeta
}

export type UserMessageEvent = ChatEventBase & {
  type: 'user.message'
  messageId: string
  text: string
}

export type AssistantStartedEvent = ChatEventBase & {
  type: 'assistant.started'
  messageId: string
}

export type AssistantDeltaEvent = ChatEventBase & {
  type: 'assistant.delta'
  messageId: string
  delta: string
}

export type ToolGroupStartedEvent = ChatEventBase & {
  type: 'tool.group.started'
  assistantMessageId: string
  groupId: string
}

export type ToolCalledEvent = ChatEventBase & {
  type: 'tool.called'
  assistantMessageId: string
  groupId: string
  requestRound: number
  toolCallId: string
  toolName: string
  argsSummary: string
}

export type ToolCompletedEvent = ChatEventBase & {
  type: 'tool.completed'
  assistantMessageId: string
  groupId: string
  requestRound: number
  toolCallId: string
  toolName: string
  outputSummary: string
  durationMs: number
  isError: boolean
  roundInputTokens: number
  roundOutputTokens: number
  roundCacheCreationTokens: number
  roundCacheReadTokens: number
  roundToolCallCount: number
}

export type AssistantApiUsage = {
  requestRound: number
  model: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  timestamp: number
}

export type AssistantCompletedEvent = ChatEventBase & {
  type: 'assistant.completed'
  messageId: string
  text: string
  durationMs: number
  apiUsages?: AssistantApiUsage[]
}

export type SessionTitleUpdatedEvent = ChatEventBase & {
  type: 'session.title.updated'
  title: string
}

export type SessionErrorEvent = ChatEventBase & {
  type: 'session.error'
  message: string
}

export type SessionCancelledEvent = ChatEventBase & {
  type: 'session.cancelled'
}

export type ChatEvent =
  | SessionCreatedEvent
  | UserMessageEvent
  | AssistantStartedEvent
  | AssistantDeltaEvent
  | ToolGroupStartedEvent
  | ToolCalledEvent
  | ToolCompletedEvent
  | AssistantCompletedEvent
  | SessionTitleUpdatedEvent
  | SessionErrorEvent
  | SessionCancelledEvent

export type ToolCallEvent = ToolCalledEvent | ToolCompletedEvent

export type AssistantTurnState = {
  assistantMessageId: string
  text: string
  status: 'streaming' | 'completed' | 'error' | 'cancelled'
  toolGroup?: {
    groupId: string
    status: 'running' | 'completed' | 'error'
    toolCount: number
    totalDurationMs: number
    summary: string
  }
}

export type SessionSnapshot = {
  meta: SessionMeta
  events: ChatEvent[]
}
