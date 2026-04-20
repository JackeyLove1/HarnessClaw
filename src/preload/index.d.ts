import type {
    CancelRun,
    CreateCronJob,
    CreateNote,
    CreateSession,
    DeleteNote,
    DeleteSession,
    DisconnectWeixinGatewayAccount,
    GetAiChannelSettings,
    GetNotes,
    GetUsageOverview,
    GetWeixinGatewayHealth,
    InstallSkill,
    ListCronJobs,
    ListCronRuns,
    ListInstalledSkills,
    ListSessions,
    ListSkillUsageRecords,
    ListSkills,
    ListToolCallRecords,
    ListToolStats,
    ListUsageRecords,
    ListWeixinGatewayAccounts,
    OpenSession,
    PauseCronJob,
    PickPromptFilePath,
    ReadCanvasArtifactHtml,
    ReadClipboardImage,
    ReadNote,
    RemoveCronJob,
    ResolveChatAttachmentDataUrl,
    ResumeCronJob,
    RunCronJob,
    SaveAiChannelSettings,
    SearchSessions,
    SearchSkills,
    SendMessage,
    SetActiveAiChannel,
    StartWeixinQrLogin,
    SubscribeChatEvents,
    TestAiChannelConnection,
    UpdateCronJob,
    UpdateSessionTitle,
    WaitWeixinQrLogin,
    WindowClose,
    WindowIsMaximized,
    WindowMinimize,
    WindowToggleMaximize,
    WriteNote
} from '@shared/types';

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
      pickPromptFilePath: PickPromptFilePath
      resolveChatAttachmentDataUrl: ResolveChatAttachmentDataUrl
      readCanvasArtifactHtml: ReadCanvasArtifactHtml
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
      listWeixinGatewayAccounts: ListWeixinGatewayAccounts
      startWeixinQrLogin: StartWeixinQrLogin
      waitWeixinQrLogin: WaitWeixinQrLogin
      disconnectWeixinGatewayAccount: DisconnectWeixinGatewayAccount
      getWeixinGatewayHealth: GetWeixinGatewayHealth
      getUsageOverview: GetUsageOverview
      listUsageRecords: ListUsageRecords
      listToolCallRecords: ListToolCallRecords
      listToolStats: ListToolStats
      listSkillUsageRecords: ListSkillUsageRecords
      listInstalledSkills: ListInstalledSkills
      searchSkills: SearchSkills
      installSkill: InstallSkill
      listSkills: ListSkills
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

export {};
