import type { ChatEvent } from '@shared/models'

export type RuntimeConfig = {
  provider: string
  model: string
  baseUrl?: string
}

export type GenerateTitleArgs = {
  sessionId: string
  userText: string
  assistantText: string
}

export type ConnectionTestResult = {
  provider: string
  model: string
  baseUrl?: string
  latencyMs: number
  preview: string
}

export type RunTurnArgs = {
  sessionId: string
  userText: string
  history?: ChatEvent[]
  signal?: AbortSignal
}

export type ChatRuntime = {
  runTurn: (args: RunTurnArgs) => AsyncIterable<ChatEvent>
  generateTitle: (args: GenerateTitleArgs) => Promise<string>
  testConnection: () => Promise<ConnectionTestResult>
}

export type PiTypeRuntime = {
  Object: (shape: Record<string, unknown>) => unknown
  String: (options?: Record<string, unknown>) => unknown
}

export type PiModel = {
  id?: string
  provider?: string
  api?: string
  baseUrl: string
  headers?: Record<string, string>
  compat?: Record<string, unknown>
}

export type PiModelResolver = (provider: string, model: string) => PiModel | undefined

export type PiAiModule = {
  Type: PiTypeRuntime
  getModel: PiModelResolver
}

export type AgentToolResult = {
  content?: Array<{ type: string; text?: string }>
  details?: {
    summary?: string
  }
}

export type AgentSubscriberEvent =
  | {
      type: 'message_update'
      assistantMessageEvent?: {
        type?: string
        delta?: string
      }
    }
  | {
      type: 'tool_execution_start'
      toolCallId: string
      toolName: string
      args?: unknown
    }
  | {
      type: 'tool_execution_end'
      toolCallId: string
      toolName: string
      result?: AgentToolResult
      isError?: boolean
    }

export type AgentStateMessage = {
  role?: string
  content?: unknown
}

export type PiAgentInstance = {
  state?: {
    messages?: AgentStateMessage[]
  }
  prompt: (text: string) => Promise<void>
  abort: () => void
  subscribe: (listener: (event: AgentSubscriberEvent) => void) => () => void
}

export type PiAgentModule = {
  Agent: new (options: {
    initialState: Record<string, unknown>
    getApiKey: (provider: string) => string | undefined
  }) => PiAgentInstance
}
