import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { getToolPriority } from '../priorities'
import type { Tool } from '../types'
import {
  LARGE_FILE_HINT_BYTES,
  READ_LINE_LIMIT_MAX,
  checkInternalReadBlocked,
  dedupMapKey,
  expandUser,
  getMaxReadChars,
  getOrCreateTaskData,
  hasBinaryExtension,
  isBlockedDevicePath,
  jsonResult,
  numParam,
  redactSensitiveText,
  strParam,
  taskIdFromParams,
  toolError,
  toolResultFromJson,
  withReadTracker
} from './utils'

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

async function readFilePaginated(filepath: string, offset: number, limit: number): Promise<ReadFileResult> {
  const expanded = expandUser(filepath)
  const stat = await fsp.stat(expanded)
  const raw = await fsp.readFile(expanded, 'utf8')
  const lines = raw.split(/\r?\n/)
  const totalLines = lines.length
  const startIndex = Math.max(0, offset - 1)
  const endIndex = Math.min(lines.length, startIndex + limit)
  const slice = lines.slice(startIndex, endIndex)
  const parts: string[] = []

  for (let index = 0; index < slice.length; index++) {
    const lineNumber = startIndex + index + 1
    parts.push(`${lineNumber}|${slice[index]}`)
  }

  return {
    content: parts.join('\n'),
    path: filepath,
    offset,
    limit,
    total_lines: totalLines,
    file_size: stat.size,
    truncated: endIndex < lines.length
  }
}

async function readFileToolImpl(filepath: string, offset: number, limit: number, taskId: string): Promise<string> {
  try {
    if (isBlockedDevicePath(filepath)) {
      return jsonResult({
        error: `Cannot read '${filepath}': this path is treated as a device or special file.`
      })
    }

    const expanded = expandUser(filepath)
    let resolvedPath: string
    try {
      resolvedPath = fs.realpathSync(expanded)
    } catch {
      resolvedPath = path.resolve(expanded)
    }

    if (hasBinaryExtension(resolvedPath)) {
      const ext = path.extname(resolvedPath).toLowerCase()
      return jsonResult({
        error: `Cannot read binary file '${filepath}' (${ext}). Use a dedicated tool for images or binaries.`
      })
    }

    const internalError = checkInternalReadBlocked(resolvedPath, filepath)
    if (internalError) {
      return internalError
    }

    const dedupKey = dedupMapKey(resolvedPath, offset, limit)
    const cachedMtime = await withReadTracker(async () => {
      const task = getOrCreateTaskData(taskId)
      return task.dedup.get(dedupKey) ?? null
    })

    if (cachedMtime !== null) {
      try {
        const stat = await fsp.stat(resolvedPath)
        if (stat.mtimeMs === cachedMtime) {
          return jsonResult({
            content:
              'File unchanged since last read. The content from the earlier read_file result in this conversation is still current - refer to that instead of re-reading.',
            path: filepath,
            dedup: true
          })
        }
      } catch {
        // Fall through to a fresh read.
      }
    }

    const result = await readFilePaginated(filepath, offset, limit)
    const maxChars = getMaxReadChars()
    if (result.content.length > maxChars) {
      return jsonResult({
        error:
          `Read produced ${result.content.length.toLocaleString()} characters which exceeds the safety limit (${maxChars.toLocaleString()} chars). ` +
          'Use offset and limit to read a smaller range.',
        path: filepath,
        total_lines: result.total_lines,
        file_size: result.file_size
      })
    }

    if (result.content) {
      result.content = redactSensitiveText(result.content)
    }

    if (result.file_size > LARGE_FILE_HINT_BYTES && limit > 200 && result.truncated) {
      result._hint =
        `This file is large (${result.file_size.toLocaleString()} bytes). ` +
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
        const stat = await fsp.stat(resolvedPath)
        task.dedup.set(dedupKey, stat.mtimeMs)
        task.readTimestamps.set(resolvedPath, stat.mtimeMs)
      } catch {
        // Ignore stat failures after a successful read.
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
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error))
  }
}

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
        path: { type: 'string', description: 'Path to the file (absolute, relative, or ~/...)' },
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
      const offset = Math.max(1, Math.floor(numParam(params.offset, 1)))
      const limit = Math.min(Math.max(1, Math.floor(numParam(params.limit, 500))), READ_LINE_LIMIT_MAX)
      const taskId = taskIdFromParams(params)
      const text = await readFileToolImpl(pathArg, offset, limit, taskId)
      return toolResultFromJson(text)
    }
  }
}
