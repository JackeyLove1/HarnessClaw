import type { ChatEvent } from '@shared/models'

export type RuntimeConfig = {
  provider: 'anthropic'
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
  hasUserContent?: boolean
  sessionMemory?: string | null
  history?: ChatEvent[]
  signal?: AbortSignal
}

export type ChatRuntime = {
  runTurn: (args: RunTurnArgs) => AsyncIterable<ChatEvent>
  generateTitle: (args: GenerateTitleArgs) => Promise<string>
  testConnection: () => Promise<ConnectionTestResult>
}
