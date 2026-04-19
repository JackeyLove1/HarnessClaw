import { createNote, deleteNote, getNotes, readNote, writeNote } from './lib'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import type {
  GetAiChannelSettings,
  ClipboardImagePayload,
  CreateNote,
  CreateCronJob,
  DeleteNote,
  GetUsageOverview,
  GetNotes,
  ListCronJobs,
  ListCronRuns,
  ListInstalledSkills,
  PickPromptFilePath,
  ListSkillUsageRecords,
  ListToolCallRecords,
  ListToolStats,
  ListUsageRecords,
  SendMessage,
  PauseCronJob,
  ReadCanvasArtifactHtml,
  ReadNote,
  RemoveCronJob,
  ResumeCronJob,
  RunCronJob,
  SaveAiChannelSettings,
  SetActiveAiChannel,
  TestAiChannelConnection,
  UpdateCronJob,
  WriteNote
} from '@shared/types'
import { BrowserWindow, app, clipboard, dialog, ipcMain, powerMonitor, shell } from 'electron'
import { join, relative, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import icon from '../../resources/icon.png?asset'
import { CronScheduler, CronService, setCronService } from './agent/cron'
import { ChatSupervisor } from './chat/supervisor'
import { readCanvasArtifactHtml } from './chat/canvas-artifacts'
import {
  getAiChannelSettings,
  hydrateAiChannelSettings,
  saveAiChannelSettings,
  setActiveAiChannel,
  testAiChannelConnection
} from './lib/ai-channel-settings'
import { initDatabase } from './lib/database'
import { runPreInstallScript } from './lib/script-runner'
import {
  loadInstalledSkillsFromDir,
  seedBundledSkillsIntoUserDir
} from './agent/skills/loadSkillsDir'

let mainWindow: BrowserWindow | null = null
let chatSupervisor: ChatSupervisor | null = null
let cronService: CronService | null = null
let cronScheduler: CronScheduler | null = null

const toErrorText = (error: unknown): string => {
  if (error instanceof Error) {
    return error.stack || error.message
  }
  return String(error)
}

const readClipboardImage = (): ClipboardImagePayload | null => {
  const image = clipboard.readImage()
  if (image.isEmpty()) {
    return null
  }

  const buffer = image.toPNG()
  const { width, height } = image.getSize()
  if (!width || !height || buffer.length === 0) {
    return null
  }

  return {
    mimeType: 'image/png',
    dataBase64: buffer.toString('base64'),
    sizeBytes: buffer.length,
    width,
    height
  }
}

const CHAT_ATTACHMENTS_DIRNAME = 'chat-attachments'

const resolveChatAttachmentDataUrl = async (
  filePath: string,
  mimeType: ClipboardImagePayload['mimeType']
): Promise<string | null> => {
  const attachmentsRoot = resolve(app.getPath('userData'), CHAT_ATTACHMENTS_DIRNAME)
  const targetPath = resolve(filePath)
  const relativePath = relative(attachmentsRoot, targetPath)
  const isInsideAttachmentsRoot =
    relativePath.length > 0 && !relativePath.startsWith('..') && !relativePath.includes(':')

  if (!isInsideAttachmentsRoot) {
    return null
  }

  try {
    const buffer = await readFile(targetPath)
    if (buffer.length === 0) {
      return null
    }
    return `data:${mimeType};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}

const createStartupErrorWindow = (title: string, detail: string): void => {
  const errorWindow = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    show: true,
    autoHideMenuBar: true,
    title: 'DeepClaw Startup Error',
    webPreferences: {
      sandbox: true,
      contextIsolation: true
    }
  })

  const html = `
  <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;background:#f8f7f4;color:#171717;font-family:'MyriadPro-Regular','MyriadPro-Light','汉仪旗黑-55S','汉仪旗黑-40S','Microsoft YaHei','Noto Sans SC',sans-serif;">
    <section style="max-width:980px;width:100%;border:1px dashed #d4d4d4;border-radius:24px;padding:24px;background:white;box-shadow:0 20px 60px rgba(0,0,0,0.06);">
      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#737373;">Main Process Startup Error</div>
      <h1 style="margin:12px 0 0;font-size:28px;line-height:1.2;">${title}</h1>
      <pre style="margin-top:16px;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.7;color:#404040;">${detail}</pre>
    </section>
  </main>
  `

  void errorWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

const showStartupError = (title: string, detail: string): void => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const html = `
    <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;background:#f8f7f4;color:#171717;font-family:'MyriadPro-Regular','MyriadPro-Light','汉仪旗黑-55S','汉仪旗黑-40S','Microsoft YaHei','Noto Sans SC',sans-serif;">
      <section style="max-width:980px;width:100%;border:1px dashed #d4d4d4;border-radius:24px;padding:24px;background:white;box-shadow:0 20px 60px rgba(0,0,0,0.06);">
        <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#737373;">Main Process Startup Error</div>
        <h1 style="margin:12px 0 0;font-size:28px;line-height:1.2;">${title}</h1>
        <pre style="margin-top:16px;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.7;color:#404040;">${detail}</pre>
      </section>
    </main>
    `
    void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    mainWindow.show()
    mainWindow.focus()
    return
  }

  createStartupErrorWindow(title, detail)
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    center: true,
    title: 'NoteMark',
    frame: false,
    ...(isMac
      ? {
          vibrancy: 'under-window',
          visualEffectState: 'active',
          titleBarStyle: 'hidden',
          trafficLightPosition: { x: 15, y: 10 }
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  const showWindowSafely = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.show()
    mainWindow.focus()
  }

  mainWindow.on('ready-to-show', () => {
    showWindowSafely()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    showWindowSafely()
  })

  // Some production environments never emit ready-to-show.
  // Ensure users still get a visible window even when first paint stalls.
  setTimeout(() => {
    showWindowSafely()
  }, 2500)

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      const html = `
      <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;background:#f8f7f4;color:#171717;font-family:'MyriadPro-Regular','MyriadPro-Light','汉仪旗黑-55S','汉仪旗黑-40S','Microsoft YaHei','Noto Sans SC',sans-serif;">
        <section style="max-width:840px;width:100%;border:1px dashed #d4d4d4;border-radius:24px;padding:24px;background:white;box-shadow:0 20px 60px rgba(0,0,0,0.06);">
          <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#737373;">Window Load Error</div>
          <h1 style="margin:12px 0 0;font-size:28px;line-height:1.2;">NoteMark failed to load its renderer.</h1>
          <pre style="margin-top:16px;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.7;color:#404040;">Code: ${errorCode}
Description: ${errorDescription}
URL: ${validatedURL}</pre>
        </section>
      </main>
    `

      void mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      showWindowSafely()
    }
  )

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const html = `
      <main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px;background:#f8f7f4;color:#171717;font-family:'MyriadPro-Regular','MyriadPro-Light','汉仪旗黑-55S','汉仪旗黑-40S','Microsoft YaHei','Noto Sans SC',sans-serif;">
        <section style="max-width:840px;width:100%;border:1px dashed #d4d4d4;border-radius:24px;padding:24px;background:white;box-shadow:0 20px 60px rgba(0,0,0,0.06);">
          <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#737373;">Renderer Crashed</div>
          <h1 style="margin:12px 0 0;font-size:28px;line-height:1.2;">The renderer process exited unexpectedly.</h1>
          <pre style="margin-top:16px;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.7;color:#404040;">Reason: ${details.reason}
Exit code: ${details.exitCode}</pre>
        </section>
      </main>
    `

    void mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    showWindowSafely()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (is.dev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  chatSupervisor?.attachWindow(mainWindow)
}

function registerWindowControls(): void {
  ipcMain.handle('window:minimize', async (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle('window:isMaximized', async (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  ipcMain.handle('window:toggleMaximize', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (window.isMaximized()) {
      window.unmaximize()
      return
    }
    window.maximize()
  })

  ipcMain.handle('window:close', async (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
}

function registerNoteIpc(): void {
  ipcMain.handle('getNotes', (_, ...args: Parameters<GetNotes>) => getNotes(...args))
  ipcMain.handle('readNote', (_, ...args: Parameters<ReadNote>) => readNote(...args))
  ipcMain.handle('writeNote', (_, ...args: Parameters<WriteNote>) => writeNote(...args))
  ipcMain.handle('createNote', (_, ...args: Parameters<CreateNote>) => createNote(...args))
  ipcMain.handle('deleteNote', (_, ...args: Parameters<DeleteNote>) => deleteNote(...args))
}

function registerChatIpc(): void {
  if (!chatSupervisor) {
    return
  }

  ipcMain.handle('chat:listSessions', () => chatSupervisor?.listSessions())
  ipcMain.handle('chat:searchSessions', (_event, query: string) =>
    chatSupervisor?.searchSessions(query)
  )
  ipcMain.handle('chat:createSession', () => chatSupervisor?.createSession())
  ipcMain.handle('chat:openSession', (_, sessionId: string) =>
    chatSupervisor?.openSession(sessionId)
  )
  ipcMain.handle('chat:updateSessionTitle', (_event, sessionId: string, title: string) => {
    return chatSupervisor?.updateSessionTitle(sessionId, title)
  })
  ipcMain.handle('chat:deleteSession', async (_event, sessionId: string) => {
    await chatSupervisor?.deleteSession(sessionId)
  })
  ipcMain.handle(
    'chat:sendMessage',
    async (_event, sessionId: string, input: Parameters<SendMessage>[1]) => {
      await chatSupervisor?.sendMessage(sessionId, input)
    }
  )
  ipcMain.handle('chat:readClipboardImage', () => readClipboardImage())
  ipcMain.handle(
    'chat:pickPromptFilePath',
    async (_event, ..._args: Parameters<PickPromptFilePath>) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return null
      }

      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择要附加到提示词的文件',
        properties: ['openFile']
      })

      if (result.canceled || result.filePaths.length === 0) {
        return null
      }

      return result.filePaths[0] ?? null
    }
  )
  ipcMain.handle(
    'chat:resolveAttachmentDataUrl',
    (_event, filePath: string, mimeType: ClipboardImagePayload['mimeType']) =>
      resolveChatAttachmentDataUrl(filePath, mimeType)
  )
  ipcMain.handle(
    'chat:readCanvasArtifactHtml',
    (_event, ...args: Parameters<ReadCanvasArtifactHtml>) =>
      readCanvasArtifactHtml(args[0].filePath)
  )
  ipcMain.handle('chat:cancelRun', async (_event, sessionId: string) => {
    await chatSupervisor?.cancelRun(sessionId)
  })
  ipcMain.handle(
    'chat:listInstalledSkills',
    async (_event, ..._args: Parameters<ListInstalledSkills>) => {
      const dedupedSkills = new Map<string, Awaited<ReturnType<ListInstalledSkills>>[number]>()
      for (const skill of loadInstalledSkillsFromDir()) {
        const key = skill.skillId.trim().toLowerCase()
        if (!key || dedupedSkills.has(key)) {
          continue
        }

        dedupedSkills.set(key, {
          skillId: skill.skillId,
          name: skill.name,
          description: skill.description,
          tags: skill.tags
        })
      }

      return [...dedupedSkills.values()]
    }
  )
}

function registerSettingsIpc(): void {
  ipcMain.handle('settings:getAiChannels', (_, ...args: Parameters<GetAiChannelSettings>) =>
    getAiChannelSettings(...args)
  )
  ipcMain.handle('settings:saveAiChannels', (_, ...args: Parameters<SaveAiChannelSettings>) =>
    saveAiChannelSettings(...args)
  )
  ipcMain.handle('settings:setActiveAiChannel', (_, ...args: Parameters<SetActiveAiChannel>) =>
    setActiveAiChannel(...args)
  )
  ipcMain.handle(
    'settings:testAiChannelConnection',
    (_, ...args: Parameters<TestAiChannelConnection>) => testAiChannelConnection(...args)
  )
  ipcMain.handle('settings:getUsageOverview', (_, ...args: Parameters<GetUsageOverview>) => {
    if (!chatSupervisor) {
      throw new Error('Chat supervisor is not initialized.')
    }
    return chatSupervisor.getUsageOverview(...args)
  })
  ipcMain.handle('settings:listUsageRecords', (_, ...args: Parameters<ListUsageRecords>) => {
    if (!chatSupervisor) {
      throw new Error('Chat supervisor is not initialized.')
    }
    return chatSupervisor.listUsageRecords(...args)
  })
  ipcMain.handle('settings:listToolCallRecords', (_, ...args: Parameters<ListToolCallRecords>) => {
    if (!chatSupervisor) {
      throw new Error('Chat supervisor is not initialized.')
    }
    return chatSupervisor.listToolCallRecords(...args)
  })
  ipcMain.handle('settings:listToolStats', (_, ...args: Parameters<ListToolStats>) => {
    if (!chatSupervisor) {
      throw new Error('Chat supervisor is not initialized.')
    }
    return chatSupervisor.listToolStats(...args)
  })
  ipcMain.handle(
    'settings:listSkillUsageRecords',
    (_, ...args: Parameters<ListSkillUsageRecords>) => {
      if (!chatSupervisor) {
        throw new Error('Chat supervisor is not initialized.')
      }
      return chatSupervisor.listSkillUsageRecords(...args)
    }
  )
}

function registerCronIpc(): void {
  if (!cronService) {
    throw new Error('Cron service is not initialized.')
  }

  ipcMain.handle('cron:listJobs', (_, ...args: Parameters<ListCronJobs>) =>
    cronService?.listJobs(...args)
  )
  ipcMain.handle('cron:listRuns', (_, ...args: Parameters<ListCronRuns>) =>
    cronService?.listRuns(...args)
  )
  ipcMain.handle('cron:createJob', (_, ...args: Parameters<CreateCronJob>) =>
    cronService?.createJob(...args)
  )
  ipcMain.handle('cron:updateJob', (_, ...args: Parameters<UpdateCronJob>) =>
    cronService?.updateJob(...args)
  )
  ipcMain.handle('cron:pauseJob', (_, ...args: Parameters<PauseCronJob>) =>
    cronService?.pauseJob(...args)
  )
  ipcMain.handle('cron:resumeJob', (_, ...args: Parameters<ResumeCronJob>) =>
    cronService?.resumeJob(...args)
  )
  ipcMain.handle('cron:removeJob', async (_, ...args: Parameters<RemoveCronJob>) => {
    await cronService?.removeJob(...args)
  })
  ipcMain.handle('cron:runJob', (_, ...args: Parameters<RunCronJob>) =>
    cronService?.runJob(...args)
  )
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.deepclaw.notemark')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerWindowControls()
  createWindow()

  try {
    initDatabase()
    cronService = new CronService()
    setCronService(cronService)
    const skillSeedResult = seedBundledSkillsIntoUserDir()
    if (skillSeedResult.sourceDir) {
      console.info(
        `[skills] seeded bundled skills from ${skillSeedResult.sourceDir} into ${skillSeedResult.userDir} ` +
          `(copied=${skillSeedResult.copiedFiles}, skipped=${skillSeedResult.skippedFiles})`
      )
    } else {
      console.warn('[skills] bundled default skills directory was not found; skipping skill seed')
    }
    void hydrateAiChannelSettings().catch((error: unknown) => {
      console.error('Failed to hydrate active AI channel settings', error)
    })
    chatSupervisor = new ChatSupervisor()
    cronService.setOriginSessionPublisher(async (sessionId, payload) => {
      if (!chatSupervisor) {
        return
      }

      await chatSupervisor.publishExternalEvent(sessionId, {
        type: 'cron.delivery',
        eventId: `cron.delivery_${payload.run.id}`,
        sessionId,
        timestamp: Date.now(),
        jobId: payload.job.id,
        runId: payload.run.id,
        jobName: payload.job.name,
        status: payload.status,
        deliverTarget: 'origin_session',
        text: payload.text
      })
    })
    cronScheduler = new CronScheduler(cronService)
    cronScheduler.start()
    powerMonitor.on('resume', () => {
      cronScheduler?.notifyResume()
    })
    if (mainWindow && !mainWindow.isDestroyed()) {
      chatSupervisor.attachWindow(mainWindow)
    }

    registerNoteIpc()
    registerChatIpc()
    registerSettingsIpc()
    registerCronIpc()

    if (mainWindow && !mainWindow.isDestroyed()) {
      runPreInstallScript(mainWindow)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  } catch (error) {
    const detail = toErrorText(error)
    console.error('[startup] initialization failed', detail)
    showStartupError('Initialization failed before UI booted.', detail)
  }
})

process.on('uncaughtException', (error) => {
  const detail = toErrorText(error)
  console.error('[process] uncaughtException', detail)
  if (app.isReady()) {
    showStartupError('Uncaught exception in main process.', detail)
  }
})

process.on('unhandledRejection', (reason) => {
  const detail = toErrorText(reason)
  console.error('[process] unhandledRejection', detail)
  if (app.isReady()) {
    showStartupError('Unhandled promise rejection in main process.', detail)
  }
})

app.on('window-all-closed', () => {
  cronScheduler?.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
