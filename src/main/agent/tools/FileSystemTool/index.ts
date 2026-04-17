import { execFile } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { z } from 'zod'

import { getToolPriority } from '../priorities'
import { defineTool, lazySchema, toolExecuteResultSchema } from '../schema'
import type { Tool } from '../types'
import { createReadFileTool } from './read'
import { checkFileStaleness, createWriteFileTool, updateReadTimestamp } from './write'
import {
  checkSensitivePath,
  clearFileOpsCache,
  clearReadTracker,
  expandUser,
  getOrCreateTaskData,
  getReadFilesSummary,
  jsonResult,
  notifyOtherToolCall,
  redactSensitiveText,
  registerInternalBlockedDirectories,
  resetFileDedup,
  toolError,
  toolResultFromJson,
  withReadTracker
} from './utils'

const execFileAsync = promisify(execFile)

const patchInputSchema = lazySchema(() =>
  z.strictObject({
    mode: z.enum(['replace', 'patch']).optional(),
    path: z.string().optional(),
    old_string: z.string().optional(),
    new_string: z.string().optional(),
    replace_all: z.boolean().optional(),
    patch: z.string().optional(),
    task_id: z.string().optional()
  })
)

const searchFilesInputSchema = lazySchema(() =>
  z.strictObject({
    pattern: z.string(),
    target: z.enum(['content', 'files', 'grep', 'find']).optional(),
    path: z.string().optional(),
    file_glob: z.string().optional(),
    limit: z.coerce
      .number()
      .transform((value) => Math.floor(value))
      .pipe(z.number().int().min(1))
      .optional(),
    offset: z.coerce
      .number()
      .transform((value) => Math.floor(value))
      .pipe(z.number().int().min(0))
      .optional(),
    output_mode: z.enum(['content', 'files_only', 'count']).optional(),
    context: z.coerce
      .number()
      .transform((value) => Math.floor(value))
      .pipe(z.number().int().min(0))
      .optional(),
    task_id: z.string().optional()
  })
)

const fileToolOutputSchema = lazySchema(() => toolExecuteResultSchema)

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
  let index = 0
  while ((index = fileContent.indexOf(oldString, index)) !== -1) {
    count += 1
    index += oldString.length
  }

  if (count === 0) {
    return { error: `Could not find old_string in file (${oldString.slice(0, 80)}...)` }
  }

  if (!replaceAll && count > 1) {
    return { error: `old_string matched ${count} times; require unique match or replace_all=true` }
  }

  const next = replaceAll
    ? fileContent.split(oldString).join(newString)
    : fileContent.replace(oldString, newString)
  return { next, replacements: replaceAll ? count : 1 }
}

function extractV4APaths(patch: string): string[] {
  const paths: string[] = []
  const re = /^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*(.+)$/gim
  let match: RegExpExecArray | null

  while ((match = re.exec(patch)) !== null) {
    paths.push(match[1].trim())
  }

  return paths
}

function applyV4ASection(content: string, body: string): { next: string } | { error: string } {
  const lines = body.split(/\r?\n/)
  const oldParts: string[] = []
  const newParts: string[] = []

  for (const line of lines) {
    if (/^\*\*\*/.test(line.trim()) || line.startsWith('@@')) {
      continue
    }
    if (line.startsWith('-')) {
      oldParts.push(line.slice(1))
    } else if (line.startsWith('+')) {
      newParts.push(line.slice(1))
    } else if (line.startsWith(' ')) {
      const trimmed = line.slice(1)
      oldParts.push(trimmed)
      newParts.push(trimmed)
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

  const index = content.indexOf(oldString)
  if (index === -1) {
    return { error: 'Could not find patch context in file' }
  }
  if (content.indexOf(oldString, index + 1) !== -1) {
    return { error: 'Patch context matched multiple times; narrow the hunk' }
  }

  return { next: content.slice(0, index) + newString + content.slice(index + oldString.length) }
}

async function applyV4APatch(patch: string): Promise<{ error: string } | Record<string, unknown>> {
  const begin = patch.indexOf('*** Begin Patch')
  const end = patch.lastIndexOf('*** End Patch')
  if (begin === -1 || end === -1 || end <= begin) {
    return { error: 'Invalid V4A patch: missing Begin/End markers' }
  }

  const inner = patch.slice(begin, end)
  const fileBlocks = inner
    .split(/(?=^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*)/gim)
    .filter(Boolean)
  const edited: string[] = []

  for (const block of fileBlocks) {
    const head = /^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*(.+)$/gim.exec(block)
    if (!head) {
      continue
    }

    const filePath = head[1].trim()
    if (/Delete/i.test(block.split('\n')[0] || '')) {
      try {
        await fsp.unlink(expandUser(filePath))
        edited.push(filePath)
      } catch (error) {
        return {
          error: `Delete failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`
        }
      }
      continue
    }

    const body = block.slice(block.indexOf('\n') + 1)
    let content = ''
    try {
      content = await fsp.readFile(expandUser(filePath), 'utf8')
    } catch {
      content = ''
    }

    const applied = applyV4ASection(content, body)
    if ('error' in applied) {
      return { error: `${filePath}: ${applied.error}` }
    }

    await fsp.mkdir(path.dirname(expandUser(filePath)), { recursive: true })
    await fsp.writeFile(expandUser(filePath), applied.next, 'utf8')
    edited.push(filePath)
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

  for (const filePath of pathsToCheck) {
    const error = checkSensitivePath(filePath)
    if (error) {
      return toolError(error)
    }
  }

  try {
    const staleWarnings: string[] = []
    for (const filePath of pathsToCheck) {
      const warning = await checkFileStaleness(filePath, taskId)
      if (warning) {
        staleWarnings.push(warning)
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
      const replaced = patchReplace(raw, oldString, newString, replaceAll)
      if ('error' in replaced) {
        let out = jsonResult({ error: replaced.error, path: filepath })
        if (replaced.error.includes('Could not find')) {
          out +=
            '\n\n[Hint: old_string not found. Use read_file to verify the current content, or search_files to locate the text.]'
        }
        return out
      }

      await fsp.writeFile(expanded, replaced.next, 'utf8')
      const result: Record<string, unknown> = {
        ok: true,
        path: filepath,
        replacements: replaced.replacements
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
        for (const filePath of pathsToCheck) {
          await updateReadTimestamp(filePath, taskId)
        }
      }
      return jsonResult(result)
    }

    return toolError(`Unknown mode: ${mode}`)
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error))
  }
}

async function hasRipgrep(): Promise<boolean> {
  try {
    await execFileAsync('rg', ['--version'], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

type SearchMatch = {
  path: string
  line?: number
  content?: string
  count?: number
}

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
    matches = stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((matchPath) => ({ path: matchPath }))
  } else if (outputMode === 'count') {
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
          const matchPath = row.data.path.text
          counts.set(matchPath, (counts.get(matchPath) ?? 0) + 1)
        }
      } catch {
        // Ignore malformed ripgrep JSON lines.
      }
    }
    matches = [...counts.entries()].map(([matchPath, count]) => ({ path: matchPath, count }))
  } else {
    const args = [
      '-n',
      '-S',
      '--max-count',
      String(Math.min(limit + offset + 500, 5000)),
      pattern,
      expandedRoot
    ]
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
      const match = /^(.+?):(\d+):(.*)$/.exec(line)
      if (match) {
        matches.push({ path: match[1], line: Number(match[2]), content: match[3] })
      }
    }
  }

  return {
    matches: matches.slice(offset, offset + limit),
    truncated: matches.length > offset + limit,
    totalApprox: matches.length
  }
}

async function* walkFiles(dir: string, maxFiles: number): AsyncGenerator<string> {
  let count = 0
  const stack = [dir]

  while (stack.length && count < maxFiles) {
    const currentDir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(currentDir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (count >= maxFiles) {
        break
      }

      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') {
          continue
        }
        stack.push(fullPath)
      } else if (entry.isFile()) {
        count += 1
        yield fullPath
      }
    }
  }
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}

async function searchFallbackFiles(
  pattern: string,
  root: string,
  limit: number,
  offset: number
): Promise<SearchMatch[]> {
  const re = globToRegExp(pattern)
  const matches: SearchMatch[] = []

  for await (const filePath of walkFiles(expandUser(root), 8000)) {
    if (re.test(path.basename(filePath))) {
      matches.push({ path: filePath })
    }
    if (matches.length >= offset + limit + 50) {
      break
    }
  }

  return matches.slice(offset, offset + limit)
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
    re = new RegExp(pattern, 'm')
  } catch {
    throw new Error(`Invalid regex: ${pattern}`)
  }

  const globRe = fileGlob ? globToRegExp(path.basename(fileGlob)) : null
  const matches: SearchMatch[] = []

  for await (const filePath of walkFiles(expandUser(root), 8000)) {
    if (globRe && !globRe.test(path.basename(filePath))) {
      continue
    }

    let text: string
    try {
      text = await fsp.readFile(filePath, 'utf8')
    } catch {
      continue
    }

    if (outputMode === 'files_only') {
      if (re.test(text) && !matches.some((match) => match.path === filePath)) {
        matches.push({ path: filePath })
      }
    } else if (outputMode === 'count') {
      let globalRe: RegExp
      try {
        globalRe = new RegExp(pattern, 'gm')
      } catch {
        throw new Error(`Invalid regex: ${pattern}`)
      }

      let count = 0
      for (const _ of text.matchAll(globalRe)) {
        count += 1
      }
      if (count) {
        matches.push({ path: filePath, count })
      }
    } else {
      const lines = text.split(/\r?\n/)
      for (let index = 0; index < lines.length; index++) {
        if (lines[index].match(re)) {
          matches.push({ path: filePath, line: index + 1, content: lines[index] })
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
        error: `BLOCKED: You have run this exact search ${count} times in a row. STOP re-searching and proceed with your task.`,
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
      const useRipgrep = (await hasRipgrep()) && context === 0
      if (useRipgrep) {
        const result = await searchWithRipgrep(
          pattern,
          searchPath,
          fileGlob,
          limit,
          offset,
          outputMode,
          context
        )
        matches = result.matches.map((match) => ({
          ...match,
          content: match.content ? redactSensitiveText(match.content) : match.content
        }))
        truncated = result.truncated
        totalApprox = result.totalApprox
      } else {
        matches = await searchFallbackContent(
          pattern,
          searchPath,
          fileGlob,
          limit,
          offset,
          outputMode
        )
        matches = matches.map((match) =>
          match.content ? { ...match, content: redactSensitiveText(match.content) } : match
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
      result._warning = `You have run this exact search ${count} times consecutively. Use the results you already have.`
    }

    let output = jsonResult(result)
    if (truncated) {
      output += `\n\n[Hint: Results truncated. Use offset=${offset + limit} to see more, or narrow pattern/file_glob.]`
    }
    return output
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error))
  }
}

export function createPatchTool(): Tool {
  return defineTool({
    name: 'patch',
    label: 'Patch file',
    priority: getToolPriority('patch'),
    description:
      'Targeted edits: mode "replace" finds a unique old_string, or mode "patch" applies a V4A-style multi-file patch.',
    inputSchema: patchInputSchema,
    outputSchema: fileToolOutputSchema,
    execute: async (_id, params) => {
      const text = await patchToolImpl(
        params.mode ?? 'replace',
        params.path,
        params.old_string,
        params.new_string,
        params.replace_all ?? false,
        params.patch,
        params.task_id || 'default'
      )
      return toolResultFromJson(text)
    }
  })
}

export function createSearchFilesTool(): Tool {
  return defineTool({
    name: 'search_files',
    label: 'Search files',
    priority: getToolPriority('search_files'),
    description:
      'Search file contents (regex) or list files by glob under a directory. Uses ripgrep when installed.',
    inputSchema: searchFilesInputSchema,
    outputSchema: fileToolOutputSchema,
    execute: async (_id, params) => {
      const rawTarget = params.target ?? 'content'
      const targetMap: Record<string, string> = {
        grep: 'content',
        find: 'files'
      }
      const target = targetMap[rawTarget] ?? rawTarget
      const text = await searchToolImpl(
        params.pattern,
        target,
        params.path ?? '.',
        params.file_glob,
        params.limit ?? 50,
        params.offset ?? 0,
        params.output_mode ?? 'content',
        params.context ?? 0,
        params.task_id || 'default'
      )
      return toolResultFromJson(text)
    }
  })
}

export function createFileSystemTools(): Tool[] {
  return [createReadFileTool(), createWriteFileTool(), createPatchTool(), createSearchFilesTool()]
}

export {
  clearFileOpsCache,
  clearReadTracker,
  createReadFileTool,
  createWriteFileTool,
  getReadFilesSummary,
  notifyOtherToolCall,
  registerInternalBlockedDirectories,
  resetFileDedup
}
