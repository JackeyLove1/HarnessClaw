/**
 * File-system tools for the LLM agent — TypeScript port of the Python “file tools” module.
 *
 * Architecture mirrors the original:
 * - Read-size guard (character cap on what enters the model context).
 * - Device / special-path blocklist (no I/O; avoids hangs and infinite reads).
 * - Binary extension guard (no content sniffing; extension set only).
 * - Sensitive write targets (resolved real path prefixes).
 * - Per-task read dedup (mtime), consecutive read/search loop detection, staleness hints on write.
 * - JSON-shaped results with `error`, optional `_warning`, `_hint`, and `dedup` fields.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { Tool } from '../types';
import { getToolPriority } from '../priorities';

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// errno codes (POSIX) — expected permission / read-only denials on write
// ---------------------------------------------------------------------------
const EXPECTED_WRITE_CODES = new Set(['EACCES', 'EPERM', 'EROFS'])

/** Default cap: ~100k chars of *formatted* read output (with line-number prefixes). */
const DEFAULT_MAX_READ_CHARS = 100_000

/** If file is larger than this (bytes) and read is wide + truncated, add a targeted-read hint. */
const LARGE_FILE_HINT_BYTES = 512_000

const READ_LINE_LIMIT_MAX = 2000

// ---------------------------------------------------------------------------
// Binary extensions — conservative list (matches “don’t stream binaries into the model”).
// ---------------------------------------------------------------------------
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
  ].map((e) => e.toLowerCase())
)

// ---------------------------------------------------------------------------
// Blocked device / special paths — literal path check only (no symlink resolution).
// ---------------------------------------------------------------------------
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

/** Windows reserved device names (any extension), e.g. `CON`, `NUL`. */
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
  ].map((s) => s.toLowerCase())
)

// ---------------------------------------------------------------------------
// Sensitive write prefixes (after realpath) — Unix + Windows
// ---------------------------------------------------------------------------
const SENSITIVE_PREFIXES_POSIX = ['/etc/', '/boot/', '/usr/lib/systemd/'] as const
const SENSITIVE_EXACT_POSIX = new Set(['/var/run/docker.sock', '/run/docker.sock'])

function getWindowsSensitivePrefixes(): string[] {
  const windir = process.env.SystemRoot || 'C:\\Windows'
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files'
  const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const norm = (p: string) => path.normalize(p).replace(/[/\\]+$/, path.sep)
  return [norm(path.join(windir, 'System32')), norm(pf), norm(pfx86)].filter(Boolean)
}

// ---------------------------------------------------------------------------
// Config cache — `file_read_max_chars` analogue via env
// ---------------------------------------------------------------------------
let maxReadCharsCached: number | null = null

function getMaxReadChars(): number {
  if (maxReadCharsCached !== null) {
    return maxReadCharsCached
  }
  const raw = process.env.NOTEMARK_FILE_READ_MAX_CHARS?.trim()
  if (raw) {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) {
      maxReadCharsCached = Math.floor(n)
      return maxReadCharsCached
    }
  }
  maxReadCharsCached = DEFAULT_MAX_READ_CHARS
  return maxReadCharsCached
}

/** Optional app-registered dirs (resolved) that must not be read (prompt-injection / internal). */
const internalBlockedDirs: string[] = []

/**
 * Register extra directories whose files must not be read by `read_file`
 * (e.g. internal skill caches). Pass absolute paths; they are resolved once.
 */
export function registerInternalBlockedDirectories(absDirs: string[]): void {
  for (const d of absDirs) {
    try {
      internalBlockedDirs.push(fs.realpathSync(path.resolve(d)))
    } catch {
      internalBlockedDirs.push(path.resolve(d))
    }
  }
}

// ---------------------------------------------------------------------------
// Read tracker state (per task_id) — same roles as Python `_read_tracker`
// ---------------------------------------------------------------------------
type ReadTrackerTask = {
  lastKey: string | null
  consecutive: number
  /** Paths and line regions read (for summaries). */
  readHistory: Set<string>
  /** (resolvedPath, offset, limit) -> mtime ms for dedup */
  dedup: Map<string, number>
  /** resolvedPath -> mtime at last read/write by this task */
  readTimestamps: Map<string, number>
}

const readTracker = new Map<string, ReadTrackerTask>()

/** Serialize mutations to readTracker across concurrent async tool calls. */
let trackerChain: Promise<void> = Promise.resolve()

function withReadTracker<T>(fn: () => Promise<T>): Promise<T> {
  let out!: T
  const next = trackerChain.then(async () => {
    out = await fn()
  })
  trackerChain = next.catch(() => {})
  return next.then(() => out)
}

function getOrCreateTaskData(taskId: string): ReadTrackerTask {
  let t = readTracker.get(taskId)
  if (!t) {
    t = {
      lastKey: null,
      consecutive: 0,
      readHistory: new Set(),
      dedup: new Map(),
      readTimestamps: new Map()
    }
    readTracker.set(taskId, t)
  }
  return t
}

function dedupMapKey(resolved: string, offset: number, limit: number): string {
  return `${resolved}\0${offset}\0${limit}`
}

// ---------------------------------------------------------------------------
// Small JSON helpers (Python `tool_error` / `json.dumps` shapes)
// ---------------------------------------------------------------------------
function toolError(message: string): string {
  return JSON.stringify({ error: message }, null, 0)
}

function jsonResult(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, null, 0)
}

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------
function expandUser(filepath: string): string {
  if (filepath === '~' || filepath.startsWith(`~${path.sep}`)) {
    return path.join(os.homedir(), filepath.slice(1).replace(/^[\\/]+/, ''))
  }
  return filepath
}

function isBlockedDevicePath(filepath: string): boolean {
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

  // Windows: \\.\NUL, \\.\pipe\..., reserved device filenames
  const lower = normalized.toLowerCase()
  if (lower.startsWith('\\\\.\\')) {
    return true
  }
  const base = path.basename(normalized, path.extname(normalized)).toLowerCase()
  if (WIN_RESERVED.has(base)) {
    return true
  }
  return false
}

function hasBinaryExtension(resolvedPath: string): boolean {
  const ext = path.extname(resolvedPath).toLowerCase()
  return ext !== '' && BINARY_EXTENSIONS.has(ext)
}

function checkSensitivePath(filepath: string): string | null {
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
    const winResolved = path.normalize(resolved)
    for (const prefix of getWindowsSensitivePrefixes()) {
      if (winResolved.startsWith(prefix)) {
        return (
          `Refusing to write to sensitive system path: ${filepath}\n` +
          'Use an elevated terminal workflow if you must modify system files.'
        )
      }
    }
  }
  return null
}

function isExpectedWriteError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false
  }
  const code = (err as NodeJS.ErrnoException).code
  return code !== undefined && EXPECTED_WRITE_CODES.has(code)
}

// ---------------------------------------------------------------------------
// Secret redaction (lightweight analogue of `redact_sensitive_text`)
// ---------------------------------------------------------------------------
function redactSensitiveText(text: string): string {
  let out = text
  out = out.replace(/\b(sk-[a-zA-Z0-9]{20,})\b/g, '[REDACTED]')
  out = out.replace(/\b(xox[baprs]-[a-zA-Z0-9-]{10,})\b/gi, '[REDACTED]')
  out = out.replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[REDACTED]')
  out = out.replace(/Bearer\s+[a-zA-Z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
  return out
}

// ---------------------------------------------------------------------------
// Internal path guard (app-configurable)
// ---------------------------------------------------------------------------
function checkInternalReadBlocked(resolvedPath: string, displayPath: string): string | null {
  let resolved: string
  try {
    resolved = fs.realpathSync(resolvedPath)
  } catch {
    resolved = resolvedPath
  }
  for (const blocked of internalBlockedDirs) {
    const rel = path.relative(blocked, resolved)
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

// ---------------------------------------------------------------------------
// File read (line-numbered, paginated)
// ---------------------------------------------------------------------------
type ReadFileResult = {
  content: string
  path: string
  offset: number
  limit: number
  total_lines: number
  file_size: number
  truncated: boolean
  dedup?: boolean
  _hint?: string
  _warning?: string
  error?: string
}

async function readFilePaginated(
  filepath: string,
  offset: number,
  limit: number
): Promise<ReadFileResult> {
  const expanded = expandUser(filepath)
  const stat = await fsp.stat(expanded)
  const raw = await fsp.readFile(expanded, 'utf8')
  const lines = raw.split(/\r?\n/)
  const totalLines = lines.length
  const startIdx = Math.max(0, offset - 1)
  const endIdx = Math.min(lines.length, startIdx + limit)
  const slice = lines.slice(startIdx, endIdx)
  const parts: string[] = []
  for (let i = 0; i < slice.length; i++) {
    const lineNo = startIdx + i + 1
    parts.push(`${lineNo}|${slice[i]}`)
  }
  const content = parts.join('\n')
  return {
    content,
    path: filepath,
    offset,
    limit,
    total_lines: totalLines,
    file_size: stat.size,
    truncated: endIdx < lines.length
  }
}

async function readFileToolImpl(
  filepath: string,
  offset: number,
  limit: number,
  taskId: string
): Promise<string> {
  try {
    if (isBlockedDevicePath(filepath)) {
      return jsonResult({
        error: `Cannot read '${filepath}': this path is treated as a device or special file.`
      })
    }

    const expanded = expandUser(filepath)
    let resolvedStr: string
    try {
      resolvedStr = fs.realpathSync(expanded)
    } catch {
      resolvedStr = path.resolve(expanded)
    }

    if (hasBinaryExtension(resolvedStr)) {
      const ext = path.extname(resolvedStr).toLowerCase()
      return jsonResult({
        error:
          `Cannot read binary file '${filepath}' (${ext}). ` +
          'Use a dedicated tool for images or binaries.'
      })
    }

    const internalErr = checkInternalReadBlocked(resolvedStr, filepath)
    if (internalErr) {
      return internalErr
    }

    const dedupKey = dedupMapKey(resolvedStr, offset, limit)
    const cachedMtime = await withReadTracker(async () => {
      const task = getOrCreateTaskData(taskId)
      return task.dedup.get(dedupKey) ?? null
    })

    if (cachedMtime !== null) {
      try {
        const st = await fsp.stat(resolvedStr)
        const mtimeMs = st.mtimeMs
        if (mtimeMs === cachedMtime) {
          return jsonResult({
            content:
              'File unchanged since last read. The content from the earlier read_file result in this conversation is still current — refer to that instead of re-reading.',
            path: filepath,
            dedup: true
          })
        }
      } catch {
        /* fall through */
      }
    }

    const result = await readFilePaginated(filepath, offset, limit)
    const maxChars = getMaxReadChars()
    const contentLen = result.content.length
    if (contentLen > maxChars) {
      return jsonResult({
        error:
          `Read produced ${contentLen.toLocaleString()} characters which exceeds the safety limit (${maxChars.toLocaleString()} chars). ` +
          'Use offset and limit to read a smaller range.',
        path: filepath,
        total_lines: result.total_lines,
        file_size: result.file_size
      })
    }

    if (result.content) {
      result.content = redactSensitiveText(result.content)
    }

    const fileSize = result.file_size
    if (fileSize > LARGE_FILE_HINT_BYTES && limit > 200 && result.truncated) {
      result._hint =
        `This file is large (${fileSize.toLocaleString()} bytes). ` +
        'Consider reading only the section you need with offset and limit to keep context usage efficient.'
    }

    const readKey = JSON.stringify(['read', filepath, offset, limit])
    const count = await withReadTracker(async () => {
      const task = getOrCreateTaskData(taskId)
      task.readHistory.add(JSON.stringify([filepath, offset, limit]))
      if (task.lastKey === readKey) {
        task.consecutive += 1
      } else {
        task.lastKey = readKey
        task.consecutive = 1
      }
      try {
        const st = await fsp.stat(resolvedStr)
        const mtimeMs = st.mtimeMs
        task.dedup.set(dedupKey, mtimeMs)
        task.readTimestamps.set(resolvedStr, mtimeMs)
      } catch {
        /* skip */
      }
      return task.consecutive
    })

    if (count >= 4) {
      return jsonResult({
        error:
          `BLOCKED: You have read this exact file region ${count} times in a row. ` +
          'The content has NOT changed. STOP re-reading and proceed with your task.',
        path: filepath,
        already_read: count
      })
    }
    if (count >= 3) {
      result._warning =
        `You have read this exact file region ${count} times consecutively. ` +
        'Use the information you already have, or proceed with writing or responding.'
    }

    return jsonResult({ ...result })
  } catch (e) {
    return toolError(e instanceof Error ? e.message : String(e))
  }
}

// ---------------------------------------------------------------------------
// Write / patch
// ---------------------------------------------------------------------------
async function updateReadTimestamp(filepath: string, taskId: string): Promise<void> {
  try {
    const expanded = expandUser(filepath)
    const resolved = fs.realpathSync(expanded)
    const st = await fsp.stat(resolved)
    await withReadTracker(async () => {
      const task = readTracker.get(taskId)
      if (task) {
        task.readTimestamps.set(resolved, st.mtimeMs)
      }
    })
  } catch {
    /* ignore */
  }
}

async function checkFileStaleness(filepath: string, taskId: string): Promise<string | null> {
  let resolved: string
  try {
    const expanded = expandUser(filepath)
    resolved = fs.realpathSync(expanded)
  } catch {
    return null
  }
  const readMtime = await withReadTracker(async () => {
    const task = readTracker.get(taskId)
    return task?.readTimestamps.get(resolved) ?? null
  })
  if (readMtime === null) {
    return null
  }
  try {
    const st = await fsp.stat(resolved)
    if (st.mtimeMs !== readMtime) {
      return (
        `Warning: ${filepath} was modified since you last read it ` +
        '(external edit or concurrent agent). Consider re-reading before writing.'
      )
    }
  } catch {
    return null
  }
  return null
}

async function writeFileToolImpl(filepath: string, content: string, taskId: string): Promise<string> {
  const sensitiveErr = checkSensitivePath(filepath)
  if (sensitiveErr) {
    return toolError(sensitiveErr)
  }
  try {
    const staleWarning = await checkFileStaleness(filepath, taskId)
    const expanded = expandUser(filepath)
    await fsp.mkdir(path.dirname(expanded), { recursive: true })
    await fsp.writeFile(expanded, content, 'utf8')
    const st = await fsp.stat(expanded)
    const result: Record<string, unknown> = {
      ok: true,
      path: filepath,
      bytes: st.size
    }
    if (staleWarning) {
      result._warning = staleWarning
    }
    await updateReadTimestamp(filepath, taskId)
    return jsonResult(result)
  } catch (e) {
    if (isExpectedWriteError(e)) {
      console.debug('write_file expected denial:', e)
    } else {
      console.error('write_file error:', e)
    }
    return toolError(e instanceof Error ? e.message : String(e))
  }
}

function patchReplace(
  fileContent: string,
  oldString: string,
  newString: string,
  replaceAll: boolean
): { next: string; replacements: number } | { error: string } {
  if (!oldString) {
    return { error: 'old_string must be non-empty' }
  }
  let count = 0
  let idx = 0
  while ((idx = fileContent.indexOf(oldString, idx)) !== -1) {
    count++
    idx += oldString.length
  }
  if (count === 0) {
    return { error: `Could not find old_string in file (${oldString.slice(0, 80)}…)` }
  }
  if (!replaceAll && count > 1) {
    return { error: `old_string matched ${count} times; require unique match or replace_all=true` }
  }
  const next = replaceAll ? fileContent.split(oldString).join(newString) : fileContent.replace(oldString, newString)
  return { next, replacements: replaceAll ? count : 1 }
}

/**
 * Minimal V4A-style patch: extract `*** Update File: <path>` sections and apply line-based hunks
 * where lines start with ` `, `-`, or `+` (optional leading space after marker).
 *
 * Limitations: one hunk per file section is applied in sequence; complex multi-hunk V4A may need
 * multiple `Update File` blocks.
 */
function extractV4APaths(patch: string): string[] {
  const paths: string[] = []
  const re = /^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*(.+)$/gim
  let m: RegExpExecArray | null
  while ((m = re.exec(patch)) !== null) {
    paths.push(m[1].trim())
  }
  return paths
}

function applyV4ASection(content: string, body: string): { next: string } | { error: string } {
  const lines = body.split(/\r?\n/)
  const oldParts: string[] = []
  const newParts: string[] = []
  for (const line of lines) {
    if (/^\*\*\*/.test(line.trim())) {
      continue
    }
    if (line.startsWith('@@')) {
      continue
    }
    if (line.startsWith('-')) {
      oldParts.push(line.slice(1))
    } else if (line.startsWith('+')) {
      newParts.push(line.slice(1))
    } else if (line.startsWith(' ')) {
      const t = line.slice(1)
      oldParts.push(t)
      newParts.push(t)
    } else if (line === '') {
      oldParts.push('')
      newParts.push('')
    }
  }
  const oldString = oldParts.join('\n')
  const newString = newParts.join('\n')
  if (!oldString && !newString) {
    return { error: 'Empty patch hunk' }
  }
  const idx = content.indexOf(oldString)
  if (idx === -1) {
    return { error: 'Could not find patch context in file' }
  }
  if (content.indexOf(oldString, idx + 1) !== -1) {
    return { error: 'Patch context matched multiple times; narrow the hunk' }
  }
  return { next: content.slice(0, idx) + newString + content.slice(idx + oldString.length) }
}

async function applyV4APatch(patch: string): Promise<{ error: string } | Record<string, unknown>> {
  const begin = patch.indexOf('*** Begin Patch')
  const end = patch.lastIndexOf('*** End Patch')
  if (begin === -1 || end === -1 || end <= begin) {
    return { error: 'Invalid V4A patch: missing Begin/End markers' }
  }
  const inner = patch.slice(begin, end)
  const fileBlocks = inner.split(/(?=^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*)/gim).filter(Boolean)
  const edited: string[] = []
  for (const block of fileBlocks) {
    const head = /^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*(.+)$/gim.exec(block)
    if (!head) {
      continue
    }
    const fp = head[1].trim()
    if (/Delete/i.test(block.split('\n')[0] || '')) {
      try {
        await fsp.unlink(expandUser(fp))
        edited.push(fp)
      } catch (e) {
        return { error: `Delete failed for ${fp}: ${e instanceof Error ? e.message : String(e)}` }
      }
      continue
    }
    const body = block.slice(block.indexOf('\n') + 1)
    let content = ''
    try {
      content = await fsp.readFile(expandUser(fp), 'utf8')
    } catch {
      content = ''
    }
    const applied = applyV4ASection(content, body)
    if ('error' in applied) {
      return { error: `${fp}: ${applied.error}` }
    }
    await fsp.mkdir(path.dirname(expandUser(fp)), { recursive: true })
    await fsp.writeFile(expandUser(fp), applied.next, 'utf8')
    edited.push(fp)
  }
  return { ok: true, files: edited }
}

async function patchToolImpl(
  mode: string,
  filepath: string | undefined,
  oldString: string | undefined,
  newString: string | undefined,
  replaceAll: boolean,
  patch: string | undefined,
  taskId: string
): Promise<string> {
  const pathsToCheck: string[] = []
  if (filepath) {
    pathsToCheck.push(filepath)
  }
  if (mode === 'patch' && patch) {
    pathsToCheck.push(...extractV4APaths(patch))
  }
  for (const p of pathsToCheck) {
    const err = checkSensitivePath(p)
    if (err) {
      return toolError(err)
    }
  }

  try {
    const staleWarnings: string[] = []
    for (const p of pathsToCheck) {
      const w = await checkFileStaleness(p, taskId)
      if (w) {
        staleWarnings.push(w)
      }
    }

    if (mode === 'replace') {
      if (!filepath) {
        return toolError('path required')
      }
      if (oldString === undefined || newString === undefined) {
        return toolError('old_string and new_string required')
      }
      const expanded = expandUser(filepath)
      const raw = await fsp.readFile(expanded, 'utf8')
      const pr = patchReplace(raw, oldString, newString, replaceAll)
      if ('error' in pr) {
        let out = jsonResult({ error: pr.error, path: filepath })
        if (pr.error.includes('Could not find')) {
          out +=
            '\n\n[Hint: old_string not found. Use read_file to verify the current content, or search_files to locate the text.]'
        }
        return out
      }
      await fsp.writeFile(expanded, pr.next, 'utf8')
      const result: Record<string, unknown> = {
        ok: true,
        path: filepath,
        replacements: pr.replacements
      }
      if (staleWarnings.length) {
        result._warning = staleWarnings.length === 1 ? staleWarnings[0] : staleWarnings.join(' | ')
      }
      await updateReadTimestamp(filepath, taskId)
      return jsonResult(result)
    }

    if (mode === 'patch') {
      if (!patch) {
        return toolError('patch content required')
      }
      const applied = await applyV4APatch(patch)
      if ('error' in applied && typeof applied.error === 'string') {
        return jsonResult(applied)
      }
      const result: Record<string, unknown> = { ...applied }
      if (staleWarnings.length) {
        result._warning = staleWarnings.length === 1 ? staleWarnings[0] : staleWarnings.join(' | ')
      }
      if (!('error' in applied)) {
        for (const p of pathsToCheck) {
          await updateReadTimestamp(p, taskId)
        }
      }
      return jsonResult(result)
    }

    return toolError(`Unknown mode: ${mode}`)
  } catch (e) {
    return toolError(e instanceof Error ? e.message : String(e))
  }
}

// ---------------------------------------------------------------------------
// Search — prefer ripgrep when available; fall back to Node walk + RegExp
// ---------------------------------------------------------------------------
async function hasRipgrep(): Promise<boolean> {
  try {
    await execFileAsync('rg', ['--version'], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

type SearchMatch = { path: string; line?: number; content?: string; count?: number }

/**
 * Ripgrep-backed search using stable text output (`path:line:content`) so we do not depend on --json schema.
 */
async function searchWithRipgrep(
  pattern: string,
  root: string,
  fileGlob: string | undefined,
  limit: number,
  offset: number,
  outputMode: string,
  context: number
): Promise<{ matches: SearchMatch[]; truncated: boolean; totalApprox: number }> {
  const expandedRoot = expandUser(root)
  let matches: SearchMatch[] = []

  if (outputMode === 'files_only') {
    const args = ['-l', '-S', pattern, expandedRoot]
    if (fileGlob) {
      args.splice(1, 0, '--glob', fileGlob)
    }
    const { stdout } = await execFileAsync('rg', args, {
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    })
    const paths = stdout.split(/\r?\n/).filter(Boolean)
    matches = paths.map((p) => ({ path: p }))
  } else if (outputMode === 'count') {
    /** Aggregate per-file match counts from `--json` (avoids `path:count` parsing on Windows drives). */
    const args = ['--json', '-S', pattern, expandedRoot]
    if (fileGlob) {
      args.splice(1, 0, '--glob', fileGlob)
    }
    const { stdout } = await execFileAsync('rg', args, {
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    })
    const counts = new Map<string, number>()
    for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
      try {
        const row = JSON.parse(line) as {
          type?: string
          data?: { path?: { text?: string } }
        }
        if (row.type === 'match' && row.data?.path?.text) {
          const p = row.data.path.text
          counts.set(p, (counts.get(p) ?? 0) + 1)
        }
      } catch {
        /* skip */
      }
    }
    matches = [...counts.entries()].map(([p, count]) => ({ path: p, count }))
  } else {
    const args = ['-n', '-S', '--max-count', String(Math.min(limit + offset + 500, 5000)), pattern, expandedRoot]
    if (fileGlob) {
      args.unshift('--glob', fileGlob)
    }
    if (context > 0) {
      args.splice(0, 0, '-C', String(context))
    }
    const { stdout } = await execFileAsync('rg', args, {
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    })
    for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
      const m = /^(.+?):(\d+):(.*)$/.exec(line)
      if (m) {
        matches.push({ path: m[1], line: Number(m[2]), content: m[3] })
      }
    }
  }

  const sliced = matches.slice(offset, offset + limit)
  return {
    matches: sliced,
    truncated: matches.length > offset + limit,
    totalApprox: matches.length
  }
}

async function* walkFiles(dir: string, maxFiles: number): AsyncGenerator<string> {
  let count = 0
  const stack = [dir]
  while (stack.length && count < maxFiles) {
    const d = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      if (count >= maxFiles) {
        break
      }
      const full = path.join(d, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git') {
          continue
        }
        stack.push(full)
      } else if (ent.isFile()) {
        count++
        yield full
      }
    }
  }
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}

async function searchFallbackFiles(pattern: string, root: string, limit: number, offset: number): Promise<SearchMatch[]> {
  const re = globToRegExp(pattern)
  const out: SearchMatch[] = []
  for await (const fp of walkFiles(expandUser(root), 8000)) {
    const base = path.basename(fp)
    if (re.test(base)) {
      out.push({ path: fp })
    }
    if (out.length >= offset + limit + 50) {
      break
    }
  }
  return out.slice(offset, offset + limit)
}

async function searchFallbackContent(
  pattern: string,
  root: string,
  fileGlob: string | undefined,
  limit: number,
  offset: number,
  outputMode: string
): Promise<SearchMatch[]> {
  let re: RegExp
  try {
    /** Line-scoped matching (avoid `/g` `lastIndex` bugs across lines). */
    re = new RegExp(pattern, 'm')
  } catch {
    throw new Error(`Invalid regex: ${pattern}`)
  }
  const globRe = fileGlob ? globToRegExp(path.basename(fileGlob)) : null
  const matches: SearchMatch[] = []
  for await (const fp of walkFiles(expandUser(root), 8000)) {
    if (globRe && !globRe.test(path.basename(fp))) {
      continue
    }
    let text: string
    try {
      text = await fsp.readFile(fp, 'utf8')
    } catch {
      continue
    }
    if (outputMode === 'files_only') {
      if (re.test(text) && !matches.some((m) => m.path === fp)) {
        matches.push({ path: fp })
      }
    } else if (outputMode === 'count') {
      let reG: RegExp
      try {
        reG = new RegExp(pattern, 'gm')
      } catch {
        throw new Error(`Invalid regex: ${pattern}`)
      }
      let n = 0
      for (const _ of text.matchAll(reG)) {
        n++
      }
      if (n) {
        matches.push({ path: fp, count: n })
      }
    } else {
      const lines = text.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(re)) {
          matches.push({ path: fp, line: i + 1, content: lines[i] })
        }
        if (matches.length >= offset + limit + 100) {
          break
        }
      }
    }
    if (matches.length >= offset + limit + 100) {
      break
    }
  }
  return matches.slice(offset, offset + limit)
}

async function searchToolImpl(
  pattern: string,
  target: string,
  searchPath: string,
  fileGlob: string | undefined,
  limit: number,
  offset: number,
  outputMode: string,
  context: number,
  taskId: string
): Promise<string> {
  try {
    const searchKey = JSON.stringify([
      'search',
      pattern,
      target,
      String(searchPath),
      fileGlob ?? '',
      limit,
      offset
    ])
    const count = await withReadTracker(async () => {
      const task = getOrCreateTaskData(taskId)
      if (task.lastKey === searchKey) {
        task.consecutive += 1
      } else {
        task.lastKey = searchKey
        task.consecutive = 1
      }
      return task.consecutive
    })

    if (count >= 4) {
      return jsonResult({
        error:
          `BLOCKED: You have run this exact search ${count} times in a row. STOP re-searching and proceed with your task.`,
        pattern,
        already_searched: count
      })
    }

    let matches: SearchMatch[] = []
    let truncated = false
    let totalApprox = 0

    if (target === 'files') {
      matches = await searchFallbackFiles(pattern, searchPath, limit, offset)
      truncated = matches.length >= limit
      totalApprox = offset + matches.length + (truncated ? 1 : 0)
    } else {
      /** Context lines (`-C`) change `rg` output; use the Node fallback for predictable parsing. */
      const useRg = (await hasRipgrep()) && context === 0
      if (useRg) {
        const r = await searchWithRipgrep(pattern, searchPath, fileGlob, limit, offset, outputMode, context)
        matches = r.matches.map((m) => ({
          ...m,
          content: m.content ? redactSensitiveText(m.content) : m.content
        }))
        truncated = r.truncated
        totalApprox = r.totalApprox
      } else {
        matches = await searchFallbackContent(pattern, searchPath, fileGlob, limit, offset, outputMode)
        matches = matches.map((m) =>
          m.content ? { ...m, content: redactSensitiveText(m.content) } : m
        )
        truncated = matches.length >= limit
        totalApprox = offset + matches.length
      }
    }

    const result: Record<string, unknown> = {
      pattern,
      target,
      path: searchPath,
      matches,
      truncated,
      total_approx: totalApprox
    }
    if (count >= 3) {
      result._warning =
        `You have run this exact search ${count} times consecutively. Use the results you already have.`
    }
    let out = jsonResult(result)
    if (truncated) {
      out += `\n\n[Hint: Results truncated. Use offset=${offset + limit} to see more, or narrow pattern/file_glob.]`
    }
    return out
  } catch (e) {
    return toolError(e instanceof Error ? e.message : String(e))
  }
}

// ---------------------------------------------------------------------------
// Session helpers (parity with Python module exports)
// ---------------------------------------------------------------------------

/** Files read per task — for context compression bookkeeping. */
export function getReadFilesSummary(taskId: string = 'default'): Array<{ path: string; regions: string[] }> {
  const task = readTracker.get(taskId)
  if (!task) {
    return []
  }
  const byPath = new Map<string, string[]>()
  for (const key of task.readHistory) {
    try {
      const [p, o, l] = JSON.parse(key) as [string, number, number]
      if (!byPath.has(p)) {
        byPath.set(p, [])
      }
      byPath.get(p)!.push(`lines ${o}-${o + l - 1}`)
    } catch {
      /* skip */
    }
  }
  return [...byPath.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([p, regions]) => ({ path: p, regions }))
}

export function clearReadTracker(taskId?: string): void {
  void withReadTracker(async () => {
    if (taskId) {
      readTracker.delete(taskId)
    } else {
      readTracker.clear()
    }
  })
}

export function resetFileDedup(taskId?: string): void {
  void withReadTracker(async () => {
    if (taskId) {
      readTracker.get(taskId)?.dedup.clear()
    } else {
      for (const t of readTracker.values()) {
        t.dedup.clear()
      }
    }
  })
}

/** No-op: local FS has no sandbox cache; kept for API parity with Python. */
export function clearFileOpsCache(_taskId?: string): void {}

/** Call when any non-read/search tool runs so consecutive counters reset. */
export function notifyOtherToolCall(taskId: string = 'default'): void {
  void withReadTracker(async () => {
    const task = readTracker.get(taskId)
    if (task) {
      task.lastKey = null
      task.consecutive = 0
    }
  })
}

// ---------------------------------------------------------------------------
// Param coercion
// ---------------------------------------------------------------------------
function numParam(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) {
      return n
    }
  }
  return fallback
}

function strParam(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function boolParam(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') {
    return v
  }
  return fallback
}

function taskIdFromParams(params: Record<string, unknown>): string {
  const t = params.task_id
  return typeof t === 'string' && t ? t : 'default'
}

// ---------------------------------------------------------------------------
// Anthropic `Tool` factories
// ---------------------------------------------------------------------------

function toolResultFromJson(text: string): { content: { type: 'text'; text: string }[]; details: { summary: string } } {
  return {
    content: [{ type: 'text', text }],
    details: { summary: clampSummary(text) }
  }
}

function clampSummary(text: string, max = 6000): string {
  if (text.length <= max) {
    return text
  }
  return `${text.slice(0, max)}\n… (${text.length - max} more chars)`
}

/** Read a text file with line numbers and pagination (`LINE_NUM|CONTENT`). */
export function createReadFileTool(): Tool {
  return {
    name: 'read_file',
    label: 'Read file',
    priority: getToolPriority('read_file'),
    description:
      'Read a text file with line numbers and pagination. Format: LINE_NUM|CONTENT. ' +
      'Use offset (1-based) and limit for large files. Reads over the character budget are rejected.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file (absolute, relative, or ~/…)' },
        offset: { type: 'integer', description: 'First line to read (1-indexed)', default: 1, minimum: 1 },
        limit: {
          type: 'integer',
          description: 'Max lines to read',
          default: 500,
          minimum: 1,
          maximum: READ_LINE_LIMIT_MAX
        },
        task_id: { type: 'string', description: 'Optional logical task id for read tracking' }
      },
      required: ['path'],
      additionalProperties: false
    },
    execute: async (_id, params) => {
      const pathArg = strParam(params.path)
      let offset = Math.max(1, Math.floor(numParam(params.offset, 1)))
      let limit = Math.floor(numParam(params.limit, 500))
      limit = Math.min(Math.max(1, limit), READ_LINE_LIMIT_MAX)
      const taskId = taskIdFromParams(params)
      const text = await readFileToolImpl(pathArg, offset, limit, taskId)
      return toolResultFromJson(text)
    }
  }
}

export function createWriteFileTool(): Tool {
  return {
    name: 'write_file',
    label: 'Write file',
    priority: getToolPriority('write_file'),
    description:
      'Write content to a file, replacing any existing file. Parent directories are created. ' +
      'Use patch for targeted edits.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        task_id: { type: 'string' }
      },
      required: ['path', 'content'],
      additionalProperties: false
    },
    execute: async (_id, params) => {
      const text = await writeFileToolImpl(strParam(params.path), strParam(params.content), taskIdFromParams(params))
      return toolResultFromJson(text)
    }
  }
}

export function createPatchTool(): Tool {
  return {
    name: 'patch',
    label: 'Patch file',
    priority: getToolPriority('patch'),
    description:
      'Targeted edits: mode "replace" finds a unique old_string, or mode "patch" applies a V4A-style multi-file patch.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['replace', 'patch'], default: 'replace' },
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean', default: false },
        patch: { type: 'string' },
        task_id: { type: 'string' }
      },
      required: ['mode'],
      additionalProperties: false
    },
    execute: async (_id, params) => {
      const mode = strParam(params.mode, 'replace')
      const text = await patchToolImpl(
        mode,
        params.path !== undefined ? strParam(params.path) : undefined,
        params.old_string !== undefined ? strParam(params.old_string) : undefined,
        params.new_string !== undefined ? strParam(params.new_string) : undefined,
        boolParam(params.replace_all, false),
        params.patch !== undefined ? strParam(params.patch) : undefined,
        taskIdFromParams(params)
      )
      return toolResultFromJson(text)
    }
  }
}

export function createSearchFilesTool(): Tool {
  return {
    name: 'search_files',
    label: 'Search files',
    priority: getToolPriority('search_files'),
    description:
      'Search file contents (regex) or list files by glob under a directory. Uses ripgrep when installed.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        target: { type: 'string', enum: ['content', 'files', 'grep', 'find'], default: 'content' },
        path: { type: 'string', default: '.' },
        file_glob: { type: 'string' },
        limit: { type: 'integer', default: 50 },
        offset: { type: 'integer', default: 0 },
        output_mode: { type: 'string', enum: ['content', 'files_only', 'count'], default: 'content' },
        context: { type: 'integer', default: 0 },
        task_id: { type: 'string' }
      },
      required: ['pattern'],
      additionalProperties: false
    },
    execute: async (_id, params) => {
      const rawTarget = strParam(params.target, 'content')
      const targetMap: Record<string, string> = { grep: 'content', find: 'files' }
      const target = targetMap[rawTarget] ?? rawTarget
      const text = await searchToolImpl(
        strParam(params.pattern),
        target,
        strParam(params.path, '.'),
        params.file_glob !== undefined ? strParam(params.file_glob) : undefined,
        Math.max(1, Math.floor(numParam(params.limit, 50))),
        Math.max(0, Math.floor(numParam(params.offset, 0))),
        strParam(params.output_mode, 'content'),
        Math.max(0, Math.floor(numParam(params.context, 0))),
        taskIdFromParams(params)
      )
      return toolResultFromJson(text)
    }
  }
}

/** All file tools (read, write, patch, search). */
export function createFileSystemTools(): Tool[] {
  return [createReadFileTool(), createWriteFileTool(), createPatchTool(), createSearchFilesTool()]
}
