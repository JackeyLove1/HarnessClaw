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

export type GetAnthropicSettings = () => Promise<AnthropicSettings>
export type SaveAnthropicSettings = (settings: AnthropicSettings) => Promise<AnthropicSettings>
export type TestAnthropicConnection = (settings: AnthropicSettings) => Promise<ConnectionCheckResult>
