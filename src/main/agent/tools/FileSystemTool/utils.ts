import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { ToolExecuteResult } from '../types'

const EXPECTED_WRITE_CODES = new Set(['EACCES', 'EPERM', 'EROFS'])

const DEFAULT_MAX_READ_CHARS = 100_000
export const LARGE_FILE_HINT_BYTES = 512_000
export const READ_LINE_LIMIT_MAX = 2000

const BINARY_EXTENSIONS = new Set(
  [
    '.7z',
    '.avi',
    '.bin',
    '.bmp',
    '.bz2',
    '.class',
    '.crdownload',
    '.dll',
    '.dmg',
    '.doc',
    '.docx',
    '.dylib',
    '.ear',
    '.exe',
    '.gif',
    '.gz',
    '.ico',
    '.jar',
    '.jpeg',
    '.jpg',
    '.m4a',
    '.mkv',
    '.mov',
    '.mp3',
    '.mp4',
    '.o',
    '.obj',
    '.odb',
    '.ods',
    '.odt',
    '.ogg',
    '.otf',
    '.pak',
    '.pdf',
    '.png',
    '.ppt',
    '.pptx',
    '.psd',
    '.pyc',
    '.pyo',
    '.rar',
    '.so',
    '.sqlite',
    '.sqlite3',
    '.tar',
    '.tgz',
    '.tif',
    '.tiff',
    '.ttf',
    '.war',
    '.wav',
    '.webm',
    '.webp',
    '.woff',
    '.woff2',
    '.xls',
    '.xlsx',
    '.zip'
  ].map((ext) => ext.toLowerCase())
)

const BLOCKED_POSIX_PATHS = new Set([
  '/dev/zero',
  '/dev/random',
  '/dev/urandom',
  '/dev/full',
  '/dev/stdin',
  '/dev/tty',
  '/dev/console',
  '/dev/stdout',
  '/dev/stderr',
  '/dev/fd/0',
  '/dev/fd/1',
  '/dev/fd/2'
])

const WIN_RESERVED = new Set(
  [
    'CON',
    'PRN',
    'AUX',
    'NUL',
    'COM1',
    'COM2',
    'COM3',
    'COM4',
    'COM5',
    'COM6',
    'COM7',
    'COM8',
    'COM9',
    'LPT1',
    'LPT2',
    'LPT3',
    'LPT4',
    'LPT5',
    'LPT6',
    'LPT7',
    'LPT8',
    'LPT9'
  ].map((name) => name.toLowerCase())
)

const SENSITIVE_PREFIXES_POSIX = ['/etc/', '/boot/', '/usr/lib/systemd/'] as const
const SENSITIVE_EXACT_POSIX = new Set(['/var/run/docker.sock', '/run/docker.sock'])

function getWindowsSensitivePrefixes(): string[] {
  const windowsDir = process.env.SystemRoot || 'C:\\Windows'
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const normalizePrefix = (input: string) => path.normalize(input).replace(/[/\\]+$/, path.sep)

  return [
    normalizePrefix(path.join(windowsDir, 'System32')),
    normalizePrefix(programFiles),
    normalizePrefix(programFilesX86)
  ]
}

let maxReadCharsCached: number | null = null

export function getMaxReadChars(): number {
  if (maxReadCharsCached !== null) {
    return maxReadCharsCached
  }

  const raw = process.env.NOTEMARK_FILE_READ_MAX_CHARS?.trim()
  if (raw) {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) {
      maxReadCharsCached = Math.floor(parsed)
      return maxReadCharsCached
    }
  }

  maxReadCharsCached = DEFAULT_MAX_READ_CHARS
  return maxReadCharsCached
}

const internalBlockedDirs: string[] = []

export function registerInternalBlockedDirectories(absDirs: string[]): void {
  for (const dir of absDirs) {
    try {
      internalBlockedDirs.push(fs.realpathSync(path.resolve(dir)))
    } catch {
      internalBlockedDirs.push(path.resolve(dir))
    }
  }
}

export type ReadTrackerTask = {
  lastKey: string | null
  consecutive: number
  readHistory: Set<string>
  dedup: Map<string, number>
  readTimestamps: Map<string, number>
}

export const readTracker = new Map<string, ReadTrackerTask>()

let trackerChain: Promise<void> = Promise.resolve()

export function withReadTracker<T>(fn: () => Promise<T>): Promise<T> {
  let out!: T
  const next = trackerChain.then(async () => {
    out = await fn()
  })

  trackerChain = next.catch(() => {})
  return next.then(() => out)
}

export function getOrCreateTaskData(taskId: string): ReadTrackerTask {
  let task = readTracker.get(taskId)
  if (!task) {
    task = {
      lastKey: null,
      consecutive: 0,
      readHistory: new Set(),
      dedup: new Map(),
      readTimestamps: new Map()
    }
    readTracker.set(taskId, task)
  }
  return task
}

export function dedupMapKey(resolvedPath: string, offset: number, limit: number): string {
  return `${resolvedPath}\0${offset}\0${limit}`
}

export function toolError(message: string): string {
  return JSON.stringify({ error: message }, null, 0)
}

export function jsonResult(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, null, 0)
}

export function expandUser(filepath: string): string {
  if (filepath === '~' || filepath.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), filepath.slice(1).replace(/^[\\/]+/, ''))
  }
  return filepath
}

export function isBlockedDevicePath(filepath: string): boolean {
  const normalized = expandUser(filepath)

  if (process.platform !== 'win32') {
    if (BLOCKED_POSIX_PATHS.has(normalized)) {
      return true
    }

    if (
      normalized.startsWith('/proc/') &&
      (normalized.endsWith('/fd/0') || normalized.endsWith('/fd/1') || normalized.endsWith('/fd/2'))
    ) {
      return true
    }

    return false
  }

  const lower = normalized.toLowerCase()
  if (lower.startsWith('\\\\.\\')) {
    return true
  }

  const base = path.basename(normalized, path.extname(normalized)).toLowerCase()
  return WIN_RESERVED.has(base)
}

export function hasBinaryExtension(resolvedPath: string): boolean {
  const ext = path.extname(resolvedPath).toLowerCase()
  return ext !== '' && BINARY_EXTENSIONS.has(ext)
}

export function checkSensitivePath(filepath: string): string | null {
  let resolved: string
  try {
    resolved = fs.realpathSync(expandUser(filepath))
  } catch {
    resolved = expandUser(filepath)
  }

  const posixResolved = resolved.replace(/\\/g, '/')
  if (process.platform !== 'win32') {
    for (const prefix of SENSITIVE_PREFIXES_POSIX) {
      if (posixResolved.startsWith(prefix)) {
        return (
          `Refusing to write to sensitive system path: ${filepath}\n` +
          'Use an elevated terminal workflow if you must modify system files.'
        )
      }
    }

    if (SENSITIVE_EXACT_POSIX.has(posixResolved)) {
      return (
        `Refusing to write to sensitive system path: ${filepath}\n` +
        'Use an elevated terminal workflow if you must modify system files.'
      )
    }
  } else {
    const windowsResolved = path.normalize(resolved)
    for (const prefix of getWindowsSensitivePrefixes()) {
      if (windowsResolved.startsWith(prefix)) {
        return (
          `Refusing to write to sensitive system path: ${filepath}\n` +
          'Use an elevated terminal workflow if you must modify system files.'
        )
      }
    }
  }

  return null
}

export function isExpectedWriteError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false
  }

  const code = (err as NodeJS.ErrnoException).code
  return code !== undefined && EXPECTED_WRITE_CODES.has(code)
}

export function redactSensitiveText(text: string): string {
  let output = text
  output = output.replace(/\b(sk-[a-zA-Z0-9]{20,})\b/g, '[REDACTED]')
  output = output.replace(/\b(xox[baprs]-[a-zA-Z0-9-]{10,})\b/gi, '[REDACTED]')
  output = output.replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[REDACTED]')
  output = output.replace(/Bearer\s+[a-zA-Z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
  return output
}

export function checkInternalReadBlocked(resolvedPath: string, displayPath: string): string | null {
  let resolved: string
  try {
    resolved = fs.realpathSync(resolvedPath)
  } catch {
    resolved = resolvedPath
  }

  for (const blockedDir of internalBlockedDirs) {
    const rel = path.relative(blockedDir, resolved)
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      return jsonResult({
        error:
          `Access denied: ${displayPath} is blocked as an internal path. ` +
          'Use the appropriate app tool instead of read_file.'
      })
    }
  }

  return null
}

export function getReadFilesSummary(taskId: string = 'default'): Array<{ path: string; regions: string[] }> {
  const task = readTracker.get(taskId)
  if (!task) {
    return []
  }

  const byPath = new Map<string, string[]>()
  for (const key of task.readHistory) {
    try {
      const [filePath, offset, limit] = JSON.parse(key) as [string, number, number]
      if (!byPath.has(filePath)) {
        byPath.set(filePath, [])
      }
      byPath.get(filePath)!.push(`lines ${offset}-${offset + limit - 1}`)
    } catch {
      // Ignore malformed tracker entries.
    }
  }

  return [...byPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([filePath, regions]) => ({ path: filePath, regions }))
}

export function clearReadTracker(taskId?: string): void {
  void withReadTracker(async () => {
    if (taskId) {
      readTracker.delete(taskId)
      return
    }
    readTracker.clear()
  })
}

export function resetFileDedup(taskId?: string): void {
  void withReadTracker(async () => {
    if (taskId) {
      readTracker.get(taskId)?.dedup.clear()
      return
    }

    for (const task of readTracker.values()) {
      task.dedup.clear()
    }
  })
}

export function clearFileOpsCache(_taskId?: string): void {}

export function notifyOtherToolCall(taskId: string = 'default'): void {
  void withReadTracker(async () => {
    const task = readTracker.get(taskId)
    if (!task) {
      return
    }
    task.lastKey = null
    task.consecutive = 0
  })
}

export function numParam(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return fallback
}

export function strParam(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

export function boolParam(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  return fallback
}

export function taskIdFromParams(params: Record<string, unknown>): string {
  const taskId = params.task_id
  return typeof taskId === 'string' && taskId ? taskId : 'default'
}

export function clampSummary(text: string, max = 6000): string {
  if (text.length <= max) {
    return text
  }
  return `${text.slice(0, max)}\n... (${text.length - max} more chars)`
}

export function toolResultFromJson(text: string): ToolExecuteResult {
  return {
    content: [{ type: 'text', text }],
    details: { summary: clampSummary(text) }
  }
}
