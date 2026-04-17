import {
  createPatchTool,
  createReadFileTool,
  createSearchFilesTool,
  createWriteFileTool
} from './FileSystemTool'
import { createGetTimeTool } from './get-time'
import type { Tool, ToolFactory } from './types'
import { DEFAULT_PRIORITY } from './priorities'

/**
 * Safe defaults for the chat runtime: time + read-only file inspection and search.
 * (No `write_file` / `patch` — add those via `createTools` or custom wiring.)
 */
export function createReadOnlyTools(): Tool[] {
  return [createGetTimeTool(), createReadFileTool(), createSearchFilesTool()].sort(
    (a, b) => (b.priority ?? DEFAULT_PRIORITY) - (a.priority ?? DEFAULT_PRIORITY)
  )
}

const toolFactories: ToolFactory[] = [
  createGetTimeTool,
  createReadFileTool,
  createWriteFileTool,
  createPatchTool,
  createSearchFilesTool
]

/**
 * 实例化当前注册表中的全部工具（含文件写入与 patch）。
 * 按 priority 降序排列，高优先级工具排在前面。
 *
 * @returns 新数组，每个元素来自对应工厂的一次调用（非缓存单例）。
 */
export function createTools(): Tool[] {
  return toolFactories
    .map((factory) => factory())
    .sort((a, b) => (b.priority ?? DEFAULT_PRIORITY) - (a.priority ?? DEFAULT_PRIORITY))
}

/** 与 Python `FILE_TOOLS` 一致的四件套工厂，以及会话级读跟踪辅助函数。 */
export {
  clearFileOpsCache,
  clearReadTracker,
  createFileSystemTools,
  getReadFilesSummary,
  notifyOtherToolCall,
  registerInternalBlockedDirectories,
  resetFileDedup
} from './FileSystemTool'

export type {
  Tool,
  ToolExecuteResult,
  ToolFactory,
  ToolInputSchema,
  ToolResultTextBlock
} from './types'
