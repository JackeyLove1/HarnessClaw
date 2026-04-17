import type { ChatEvent } from '@shared/models'
import type {
  CancelRun,
  CreateNote,
  CreateSession,
  DeleteSession,
  DeleteNote,
  GetAnthropicSettings,
  GetNotes,
  GetUsageOverview,
  ListToolCallRecords,
  ListToolStats,
  ListUsageRecords,
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
import { contextBridge, ipcRenderer } from 'electron'

if (!process.contextIsolated) {
  throw new Error('contextIsolation must be enabled in the BrowserWindow')
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args)

const subscribeChatEvents: SubscribeChatEvents = (sessionId, listener) => {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: ChatEvent): void => {
    if (payload.sessionId === sessionId) {
      listener(payload)
    }
  }

  ipcRenderer.on('chat:event', wrapped)

  return () => {
    ipcRenderer.removeListener('chat:event', wrapped)
  }
}

try {
  contextBridge.exposeInMainWorld('context', {
    locale: navigator.language,
    getNotes: (...args: Parameters<GetNotes>) =>
      invoke<Awaited<ReturnType<GetNotes>>>('getNotes', ...args),
    readNote: (...args: Parameters<ReadNote>) =>
      invoke<Awaited<ReturnType<ReadNote>>>('readNote', ...args),
    writeNote: (...args: Parameters<WriteNote>) =>
      invoke<Awaited<ReturnType<WriteNote>>>('writeNote', ...args),
    createNote: (...args: Parameters<CreateNote>) =>
      invoke<Awaited<ReturnType<CreateNote>>>('createNote', ...args),
    deleteNote: (...args: Parameters<DeleteNote>) =>
      invoke<Awaited<ReturnType<DeleteNote>>>('deleteNote', ...args),
    listSessions: (...args: Parameters<ListSessions>) =>
      invoke<Awaited<ReturnType<ListSessions>>>('chat:listSessions', ...args),
    searchSessions: (...args: Parameters<SearchSessions>) =>
      invoke<Awaited<ReturnType<SearchSessions>>>('chat:searchSessions', ...args),
    createSession: (...args: Parameters<CreateSession>) =>
      invoke<Awaited<ReturnType<CreateSession>>>('chat:createSession', ...args),
    openSession: (...args: Parameters<OpenSession>) =>
      invoke<Awaited<ReturnType<OpenSession>>>('chat:openSession', ...args),
    updateSessionTitle: (...args: Parameters<UpdateSessionTitle>) =>
      invoke<Awaited<ReturnType<UpdateSessionTitle>>>('chat:updateSessionTitle', ...args),
    deleteSession: (...args: Parameters<DeleteSession>) =>
      invoke<Awaited<ReturnType<DeleteSession>>>('chat:deleteSession', ...args),
    sendMessage: (...args: Parameters<SendMessage>) =>
      invoke<Awaited<ReturnType<SendMessage>>>('chat:sendMessage', ...args),
    cancelRun: (...args: Parameters<CancelRun>) =>
      invoke<Awaited<ReturnType<CancelRun>>>('chat:cancelRun', ...args),
    subscribeChatEvents,
    windowMinimize: (...args: Parameters<WindowMinimize>) =>
      invoke<Awaited<ReturnType<WindowMinimize>>>('window:minimize', ...args),
    windowIsMaximized: (...args: Parameters<WindowIsMaximized>) =>
      invoke<Awaited<ReturnType<WindowIsMaximized>>>('window:isMaximized', ...args),
    windowToggleMaximize: (...args: Parameters<WindowToggleMaximize>) =>
      invoke<Awaited<ReturnType<WindowToggleMaximize>>>('window:toggleMaximize', ...args),
    windowClose: (...args: Parameters<WindowClose>) =>
      invoke<Awaited<ReturnType<WindowClose>>>('window:close', ...args),
    getAnthropicSettings: (...args: Parameters<GetAnthropicSettings>) =>
      invoke<Awaited<ReturnType<GetAnthropicSettings>>>('settings:getAnthropic', ...args),
    saveAnthropicSettings: (...args: Parameters<SaveAnthropicSettings>) =>
      invoke<Awaited<ReturnType<SaveAnthropicSettings>>>('settings:saveAnthropic', ...args),
    testAnthropicConnection: (...args: Parameters<TestAnthropicConnection>) =>
      invoke<Awaited<ReturnType<TestAnthropicConnection>>>(
        'settings:testAnthropicConnection',
        ...args
      ),
    getUsageOverview: (...args: Parameters<GetUsageOverview>) =>
      invoke<Awaited<ReturnType<GetUsageOverview>>>('settings:getUsageOverview', ...args),
    listUsageRecords: (...args: Parameters<ListUsageRecords>) =>
      invoke<Awaited<ReturnType<ListUsageRecords>>>('settings:listUsageRecords', ...args),
    listToolCallRecords: (...args: Parameters<ListToolCallRecords>) =>
      invoke<Awaited<ReturnType<ListToolCallRecords>>>('settings:listToolCallRecords', ...args),
    listToolStats: (...args: Parameters<ListToolStats>) =>
      invoke<Awaited<ReturnType<ListToolStats>>>('settings:listToolStats', ...args)
  })
} catch (error) {
  console.error(error)
}
