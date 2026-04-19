import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type BrowserWindow, app } from 'electron'

const SCRIPTS_DIR_CANDIDATES = app.isPackaged
  ? [join(process.resourcesPath, 'scripts')]
  : [
      join(__dirname, '../../../src/scripts') // out/main/../../../src/scripts
    ]

type ScriptEvent =
  | { type: 'start'; script: string }
  | { type: 'stdout'; data: string }
  | { type: 'stderr'; data: string }
  | { type: 'exit'; code: number | null }

function sendToRenderer(win: BrowserWindow, event: ScriptEvent): void {
  if (!win.isDestroyed()) {
    win.webContents.send('script:event', event)
  }
}

function resolveScript(): { command: string; args: string[]; script: string; cwd: string } | null {
  for (const dir of SCRIPTS_DIR_CANDIDATES) {
    if (process.platform === 'win32') {
      const ps1 = join(dir, 'pre-install.ps1')
      if (existsSync(ps1)) {
        return {
          command: 'powershell.exe',
          args: ['-NoProfile', '-ExecutionPolicy', '-Bypass', '-File', ps1],
          script: ps1,
          cwd: dir
        }
      }
    }

    const sh = join(dir, 'pre-install.sh')
    if (existsSync(sh)) {
      return {
        command: '/bin/bash',
        args: [sh],
        script: sh,
        cwd: dir
      }
    }
  }

  return null
}

let runningProcess: ChildProcess | null = null

export function runPreInstallScript(win: BrowserWindow): void {
  const resolved = resolveScript()
  if (!resolved) {
    console.warn('[script-runner] no pre-install script found, skipping')
    return
  }

  if (runningProcess) {
    console.warn('[script-runner] a script is already running, skipping')
    return
  }

  const { command, args, script, cwd } = resolved
  console.info(`[script-runner] spawning: ${command} ${args.join(' ')}`)
  sendToRenderer(win, { type: 'start', script })

  const child = spawn(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  })

  runningProcess = child

  child.stdout?.on('data', (chunk: Buffer) => {
    const data = chunk.toString('utf8')
    process.stdout.write(`[script-runner][stdout] ${data}`)
    sendToRenderer(win, { type: 'stdout', data })
  })

  child.stderr?.on('data', (chunk: Buffer) => {
    const data = chunk.toString('utf8')
    process.stderr.write(`[script-runner][stderr] ${data}`)
    sendToRenderer(win, { type: 'stderr', data })
  })

  child.on('close', (code) => {
    runningProcess = null
    console.info(`[script-runner] exited with code ${code}`)
    sendToRenderer(win, { type: 'exit', code })
  })

  child.on('error', (error) => {
    runningProcess = null
    console.error('[script-runner] spawn error:', error)
    sendToRenderer(win, { type: 'stderr', data: `spawn error: ${error.message}\n` })
    sendToRenderer(win, { type: 'exit', code: -1 })
  })
}
