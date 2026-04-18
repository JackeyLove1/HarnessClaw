import type {
  GetAiChannelSettings,
  CancelRun,
  CreateNote,
  CreateCronJob,
  CreateSession,
  DeleteSession,
  DeleteNote,
  GetNotes,
  GetUsageOverview,
  ListCronJobs,
  ListCronRuns,
  ListSkillUsageRecords,
  ListToolCallRecords,
  ListToolStats,
  ListUsageRecords,
  ListSessions,
  OpenSession,
  PauseCronJob,
  ReadClipboardImage,
  ResolveChatAttachmentDataUrl,
  ReadNote,
  RemoveCronJob,
  ResumeCronJob,
  RunCronJob,
  SaveAiChannelSettings,
  SearchSessions,
  SendMessage,
  SetActiveAiChannel,
  SubscribeChatEvents,
  TestAiChannelConnection,
  UpdateCronJob,
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
      readClipboardImage: ReadClipboardImage
      resolveChatAttachmentDataUrl: ResolveChatAttachmentDataUrl
      cancelRun: CancelRun
      subscribeChatEvents: SubscribeChatEvents
      windowMinimize: WindowMinimize
      windowIsMaximized: WindowIsMaximized
      windowToggleMaximize: WindowToggleMaximize
      windowClose: WindowClose
      getAiChannelSettings: GetAiChannelSettings
      saveAiChannelSettings: SaveAiChannelSettings
      setActiveAiChannel: SetActiveAiChannel
      testAiChannelConnection: TestAiChannelConnection
      getUsageOverview: GetUsageOverview
      listUsageRecords: ListUsageRecords
      listToolCallRecords: ListToolCallRecords
      listToolStats: ListToolStats
      listSkillUsageRecords: ListSkillUsageRecords
      listCronJobs: ListCronJobs
      listCronRuns: ListCronRuns
      createCronJob: CreateCronJob
      updateCronJob: UpdateCronJob
      pauseCronJob: PauseCronJob
      resumeCronJob: ResumeCronJob
      removeCronJob: RemoveCronJob
      runCronJob: RunCronJob
    }
  }
}

export {}
