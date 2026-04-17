/**
 * Tool result persistence -- preserves large outputs instead of truncating.
 *
 * Operates at three levels:
 * 1. Per-tool output cap (inside each tool): Tools pre-truncate their own output.
 * 2. Per-result persistence (maybePersistToolResult): After a tool returns, if its
 *    output exceeds the threshold, the full output is written to disk and replaced
 *    with a preview + file path reference.
 * 3. Per-turn aggregate budget (enforceTurnBudget): After all tool results in a
 *    single assistant turn are collected, if the total exceeds budget, the largest
 *    non-persisted results are spilled to disk.
 */

import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { Tool } from './types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PERSISTED_OUTPUT_TAG = '<persisted-output>'
const PERSISTED_OUTPUT_CLOSING_TAG = '</persisted-output>'
const BUDGET_TOOL_NAME = '__budget_enforcement__'
const DEFAULT_PREVIEW_SIZE_CHARS = 2000
const DEFAULT_TURN_BUDGET_CHARS = 200_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BudgetConfig {
  /** Default preview size in characters */
  previewSize: number
  /** Per-tool thresholds: tool_name -> max inline chars (Infinity = never persist) */
  thresholds: Record<string, number>
  /** Budget for total tool results per turn */
  turnBudget: number
}

export interface PersistedResult {
  preview: string
  hasMore: boolean
  originalSize: number
  filePath: string
}

// ---------------------------------------------------------------------------
// Default budget configuration
// ---------------------------------------------------------------------------

const DEFAULT_BUDGET: BudgetConfig = {
  previewSize: DEFAULT_PREVIEW_SIZE_CHARS,
  thresholds: {
    read_file: 50_000,
    bash: 60_000,
    powershell: 60_000,
    patch: 40_000,
    write_file: 40_000,
    get_time: 1_000
  },
  turnBudget: DEFAULT_TURN_BUDGET_CHARS
}

// ---------------------------------------------------------------------------
// Storage directory resolution
// ---------------------------------------------------------------------------

function resolveStorageDir(): string {
  const homeDir = os.homedir()
  const tempDir = os.tmpdir()
  // Prefer user's temp directory on Windows
  const baseDir = process.platform === 'win32' ? tempDir : homeDir
  return path.join(baseDir, '.deepclaw', 'tmp')
}

// ---------------------------------------------------------------------------
// Preview generation
// ---------------------------------------------------------------------------

function generatePreview(content: string, maxChars: number): { preview: string; hasMore: boolean } {
  if (content.length <= maxChars) {
    return { preview: content, hasMore: false }
  }

  let truncated = content.slice(0, maxChars)
  const lastNl = truncated.lastIndexOf('\n')
  if (lastNl > maxChars / 2) {
    truncated = truncated.slice(0, lastNl + 1)
  }

  return { preview: truncated, hasMore: truncated.length < content.length }
}

// ---------------------------------------------------------------------------
// File write
// ---------------------------------------------------------------------------

async function writeToFile(content: string, filePath: string): Promise<boolean> {
  try {
    const dir = path.dirname(filePath)
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(filePath, content, 'utf8')
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Build persisted message
// ---------------------------------------------------------------------------

function buildPersistedMessage(
  preview: string,
  hasMore: boolean,
  originalSize: number,
  filePath: string
): string {
  const sizeKb = originalSize / 1024
  const sizeStr = sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb.toFixed(1)} KB`

  let msg = `${PERSISTED_OUTPUT_TAG}\n`
  msg += `This tool result was too large (${originalSize.toLocaleString()} characters, ${sizeStr}).\n`
  msg += `Full output saved to: ${filePath}\n`
  msg +=
    'Use the read_file tool with offset and limit to access specific sections of this output.\n\n'
  msg += `Preview (first ${preview.length} chars):\n`
  msg += preview
  if (hasMore) {
    msg += '\n...'
  }
  msg += `\n${PERSISTED_OUTPUT_CLOSING_TAG}`
  return msg
}

// ---------------------------------------------------------------------------
// Core persistence function
// ---------------------------------------------------------------------------

export function resolveThreshold(toolName: string, config: BudgetConfig = DEFAULT_BUDGET): number {
  return config.thresholds[toolName] ?? 80_000
}

/**
 * Layer 2: persist oversized result into the sandbox, return preview + path.
 *
 * Writes the full content to disk and returns a replacement message with
 * a preview and file path reference.
 */
export async function maybePersistToolResult(
  content: string,
  toolName: string,
  toolCallId: string,
  config: BudgetConfig = DEFAULT_BUDGET,
  threshold?: number
): Promise<string> {
  const effectiveThreshold = threshold ?? resolveThreshold(toolName, config)

  if (effectiveThreshold === Infinity || content.length <= effectiveThreshold) {
    return content
  }

  const storageDir = resolveStorageDir()
  const remotePath = path.join(storageDir, `${toolCallId}.txt`)
  const { preview, hasMore } = generatePreview(content, config.previewSize)

  const writeSuccess = await writeToFile(content, remotePath)
  if (writeSuccess) {
    return buildPersistedMessage(preview, hasMore, content.length, remotePath)
  }

  // Fallback: inline truncation if write fails
  return (
    `${preview}\n\n` +
    `[Truncated: tool response was ${content.length.toLocaleString()} chars. ` +
    `Full output could not be saved to sandbox.]`
  )
}

// ---------------------------------------------------------------------------
// Turn budget enforcement
// ---------------------------------------------------------------------------

export interface ToolMessage {
  content: string
  tool_call_id?: string
}

/**
 * Layer 3: enforce aggregate budget across all tool results in a turn.
 *
 * If total chars exceed budget, persist the largest non-persisted results
 * first (via file write) until under budget. Already-persisted results
 * are skipped.
 */
export async function enforceTurnBudget(
  toolMessages: ToolMessage[],
  config: BudgetConfig = DEFAULT_BUDGET
): Promise<ToolMessage[]> {
  const candidates: Array<{ index: number; size: number }> = []
  let totalSize = 0

  for (let i = 0; i < toolMessages.length; i++) {
    const content = toolMessages[i].content ?? ''
    const size = content.length
    totalSize += size
    if (!content.includes(PERSISTED_OUTPUT_TAG)) {
      candidates.push({ index: i, size })
    }
  }

  if (totalSize <= config.turnBudget) {
    return toolMessages
  }

  // Sort by size descending, persist largest first
  candidates.sort((a, b) => b.size - a.size)

  for (const { index, size } of candidates) {
    if (totalSize <= config.turnBudget) {
      break
    }

    const msg = toolMessages[index]
    const content = msg.content
    const toolUseId = msg.tool_call_id ?? `budget_${index}`

    const replacement = await maybePersistToolResult(
      content,
      BUDGET_TOOL_NAME,
      toolUseId,
      config,
      0 // threshold=0 forces persistence
    )

    if (replacement !== content) {
      totalSize -= size
      totalSize += replacement.length
      toolMessages[index] = { ...msg, content: replacement }
    }
  }

  return toolMessages
}

// ---------------------------------------------------------------------------
// Tool result wrapper with persistence
// ---------------------------------------------------------------------------

/**
 * Wraps a tool's execute function to apply result persistence.
 */
export function withResultPersistence(tool: Tool, config: BudgetConfig = DEFAULT_BUDGET): Tool {
  return {
    ...tool,
    execute: async (toolCallId, params) => {
      const result = await tool.execute(toolCallId, params)
      const text = result.content[0]?.text ?? ''
      const threshold = resolveThreshold(tool.name, config)

      if (text.length > threshold) {
        const persistedText = await maybePersistToolResult(text, tool.name, toolCallId, config)
        return {
          ...result,
          content: [{ type: 'text', text: persistedText }]
        }
      }

      return result
    }
  }
}

// ---------------------------------------------------------------------------
// Re-export types
// ---------------------------------------------------------------------------

export { DEFAULT_BUDGET }
