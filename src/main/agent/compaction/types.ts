import type { ChatEvent } from '@shared/models'

export type SessionMemoryCompactor = {
  bootstrapSessionMemory: (args: {
    sessionId: string
    history: ChatEvent[]
    signal?: AbortSignal
  }) => Promise<string>
  extendSessionMemory: (args: {
    sessionId: string
    previousSummary: string
    historyDelta: ChatEvent[]
    signal?: AbortSignal
  }) => Promise<string>
}
