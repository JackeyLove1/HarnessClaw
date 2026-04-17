import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { getToolPriority } from '../priorities'
import type { Tool } from '../types'
import {
  checkSensitivePath,
  expandUser,
  isExpectedWriteError,
  jsonResult,
  readTracker,
  strParam,
  taskIdFromParams,
  toolError,
  toolResultFromJson,
  withReadTracker
} from './utils'

export async function updateReadTimestamp(filepath: string, taskId: string): Promise<void> {
  try {
    const expanded = expandUser(filepath)
    const resolved = fs.realpathSync(expanded)
    const stat = await fsp.stat(resolved)

    await withReadTracker(async () => {
      const task = readTracker.get(taskId)
      if (task) {
        task.readTimestamps.set(resolved, stat.mtimeMs)
      }
    })
  } catch {
    // Ignore timestamp refresh failures after writes.
  }
}

export async function checkFileStaleness(filepath: string, taskId: string): Promise<string | null> {
  let resolved: string
  try {
    resolved = fs.realpathSync(expandUser(filepath))
  } catch {
    return null
  }

  const readMtime = await withReadTracker(async () => readTracker.get(taskId)?.readTimestamps.get(resolved) ?? null)
  if (readMtime === null) {
    return null
  }

  try {
    const stat = await fsp.stat(resolved)
    if (stat.mtimeMs !== readMtime) {
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
  const sensitiveError = checkSensitivePath(filepath)
  if (sensitiveError) {
    return toolError(sensitiveError)
  }

  try {
    const staleWarning = await checkFileStaleness(filepath, taskId)
    const expanded = expandUser(filepath)
    await fsp.mkdir(path.dirname(expanded), { recursive: true })
    await fsp.writeFile(expanded, content, 'utf8')
    const stat = await fsp.stat(expanded)

    const result: Record<string, unknown> = {
      ok: true,
      path: filepath,
      bytes: stat.size
    }
    if (staleWarning) {
      result._warning = staleWarning
    }

    await updateReadTimestamp(filepath, taskId)
    return jsonResult(result)
  } catch (error) {
    if (isExpectedWriteError(error)) {
      console.debug('write_file expected denial:', error)
    } else {
      console.error('write_file error:', error)
    }
    return toolError(error instanceof Error ? error.message : String(error))
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
