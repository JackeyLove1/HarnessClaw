import fsp from 'node:fs/promises'
import path from 'node:path'

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
  getReadFilesSummary,
  jsonResult,
  notifyOtherToolCall,
  registerInternalBlockedDirectories,
  resetFileDedup,
  toolError,
  toolResultFromJson
} from './utils'

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
          out += '\n\n[Hint: old_string not found. Use read_file to verify the current content.]'
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

export function createFileSystemTools(): Tool[] {
  return [createReadFileTool(), createWriteFileTool(), createPatchTool()]
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
