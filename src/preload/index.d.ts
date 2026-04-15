import type {
  CancelRun,
  CreateNote,
  CreateSession,
  DeleteSession,
  DeleteNote,
  GetAnthropicSettings,
  GetNotes,
  ListSessions,
  OpenSession,
  ReadNote,
  SaveAnthropicSettings,
  SearchSessions,
  SendMessage,
  SubscribeChatEvents,
  TestAnthropicConnection,
  UpdateSessionTitle,
  WindowClose,
  WindowIsMaximized,
  WindowMinimize,
  WindowToggleMaximize,
  WriteNote
} from '@shared/types'

declare global {
  interface Window {
    context: {
      locale: string
      getNotes: GetNotes
      readNote: ReadNote
      writeNote: WriteNote
      createNote: CreateNote
      deleteNote: DeleteNote
      listSessions: ListSessions
      searchSessions: SearchSessions
      createSession: CreateSession
      openSession: OpenSession
      updateSessionTitle: UpdateSessionTitle
      deleteSession: DeleteSession
      sendMessage: SendMessage
      cancelRun: CancelRun
      subscribeChatEvents: SubscribeChatEvents
      windowMinimize: WindowMinimize
      windowIsMaximized: WindowIsMaximized
      windowToggleMaximize: WindowToggleMaximize
      windowClose: WindowClose
      getAnthropicSettings: GetAnthropicSettings
      saveAnthropicSettings: SaveAnthropicSettings
      testAnthropicConnection: TestAnthropicConnection
    }
  }
}

export {}
