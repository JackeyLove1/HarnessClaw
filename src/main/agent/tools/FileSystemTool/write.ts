import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import { getToolPriority } from '../priorities'
import { defineTool, lazySchema, toolExecuteResultSchema } from '../schema'
import type { Tool } from '../types'
import {
  checkSensitivePath,
  expandUser,
  isExpectedWriteError,
  jsonResult,
  readTracker,
  toolError,
  toolResultFromJson,
  withReadTracker
} from './utils'

const writeFileInputSchema = lazySchema(() =>
  z.strictObject({
    path: z.string(),
    content: z.string(),
    task_id: z.string().optional()
  })
)

const writeFileOutputSchema = lazySchema(() => toolExecuteResultSchema)

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

  const readMtime = await withReadTracker(
    async () => readTracker.get(taskId)?.readTimestamps.get(resolved) ?? null
  )
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

async function writeFileToolImpl(
  filepath: string,
  content: string,
  taskId: string
): Promise<string> {
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
  return defineTool({
    name: 'write_file',
    label: 'Write file',
    priority: getToolPriority('write_file'),
    description:
      'Write content to a file, replacing any existing file. Parent directories are created. ' +
      'Use patch for targeted edits.',
    inputSchema: writeFileInputSchema,
    outputSchema: writeFileOutputSchema,
    execute: async (_id, params) => {
      const text = await writeFileToolImpl(params.path, params.content, params.task_id || 'default')
      return toolResultFromJson(text)
    }
  })
}
