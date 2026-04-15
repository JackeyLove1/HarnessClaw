import { createNote, deleteNote, getNotes, readNote, writeNote } from './lib'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import type { CreateNote, DeleteNote, GetNotes, ReadNote, WriteNote } from '@shared/types'
import { BrowserWindow, app, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import icon from '../../resources/icon.png?asset'
import { ChatSupervisor } from './chat/supervisor'

let mainWindow: BrowserWindow | null = null
let chatSupervisor: ChatSupervisor | null = null

function createWindow(): void {
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
    vibrancy: 'under-window',
    visualEffectState: 'active',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 10 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
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
  })

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
  ipcMain.handle('chat:createSession', () => chatSupervisor?.createSession())
  ipcMain.handle('chat:openSession', (_, sessionId: string) => chatSupervisor?.openSession(sessionId))
  ipcMain.handle('chat:updateSessionTitle', (_event, sessionId: string, title: string) => {
    return chatSupervisor?.updateSessionTitle(sessionId, title)
  })
  ipcMain.handle('chat:deleteSession', async (_event, sessionId: string) => {
    await chatSupervisor?.deleteSession(sessionId)
  })
  ipcMain.handle('chat:sendMessage', async (_event, sessionId: string, text: string) => {
    await chatSupervisor?.sendMessage(sessionId, text)
  })
  ipcMain.handle('chat:cancelRun', async (_event, sessionId: string) => {
    await chatSupervisor?.cancelRun(sessionId)
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  chatSupervisor = new ChatSupervisor()

  registerWindowControls()
  registerNoteIpc()
  registerChatIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
