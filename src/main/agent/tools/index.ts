import { createBashTool, type BashToolOptions } from './BashTool'
import { ChatSessionStore } from '../../chat/session-store'
import { createPatchTool, createReadFileTool, createWriteFileTool } from './FileSystemTool'
import { createGetTimeTool } from './get-time'
import { createPowerShellTool, type PowerShellToolOptions } from './PowerShellTool'
import { createTodoTool } from './TodoTool'
import { compareToolPriorityMetrics } from './priorities'
import type {
  PostToolUseHook,
  PreToolUseHook,
  ShellCommandRunner,
  ShellPermissionOptions
} from './ShellTool'
import type { Tool, ToolFactory } from './types'
import { withResultPersistence, DEFAULT_BUDGET, type BudgetConfig } from './budget'

const readToolUseCounts = (): Map<string, number> => {
  try {
    return new ChatSessionStore().getToolUseCountsSync()
  } catch {
    return new Map()
  }
}

export function sortToolsByUsagePriority(
  tools: Tool[],
  useCounts: ReadonlyMap<string, number> = readToolUseCounts()
): Tool[] {
  return [...tools].sort((left, right) =>
    compareToolPriorityMetrics(
      {
        name: left.name,
        basePriority: left.priority,
        useCount: useCounts.get(left.name) ?? 0
      },
      {
        name: right.name,
        basePriority: right.priority,
        useCount: useCounts.get(right.name) ?? 0
      }
    )
  )
}

/**
 * Safe defaults for the chat runtime: time + read-only file inspection.
 * (No `write_file` / `patch` — add those via `createTools` or custom wiring.)
 */
export function createReadOnlyTools(): Tool[] {
  return sortToolsByUsagePriority([createGetTimeTool(), createReadFileTool()])
}

const toolFactories: ToolFactory[] = [
  createGetTimeTool,
  createReadFileTool,
  createWriteFileTool,
  createPatchTool,
  createTodoTool
]

export type PlatformShellToolOptions = ShellPermissionOptions & {
  preToolUseHooks?: PreToolUseHook[]
  postToolUseHooks?: PostToolUseHook[]
  runCommand?: ShellCommandRunner
}

export type CreateToolsOptions = {
  platform?: NodeJS.Platform
  shellTool?: PlatformShellToolOptions
  budgetConfig?: BudgetConfig
}

export function createPlatformShellTool(
  platform: NodeJS.Platform = process.platform,
  options: PlatformShellToolOptions = {}
): Tool {
  if (platform === 'win32') {
    const powerShellOptions: PowerShellToolOptions = { ...options }
    return createPowerShellTool(powerShellOptions)
  }

  const bashOptions: BashToolOptions = { ...options }
  return createBashTool(bashOptions)
}

/**
 * 实例化当前注册表中的全部工具（含文件写入与 patch）。
 * 按 priority 降序排列，高优先级工具排在前面。
 *
 * @returns 新数组，每个元素来自对应工厂的一次调用（非缓存单例）。
 */
export function createTools(options: CreateToolsOptions = {}): Tool[] {
  const config = options.budgetConfig ?? DEFAULT_BUDGET
  const baseTools = [
    ...toolFactories.map((factory) => factory()),
    createPlatformShellTool(options.platform, options.shellTool)
  ]
  const withPersistence = baseTools.map((tool) => withResultPersistence(tool, config))
  return sortToolsByUsagePriority(withPersistence)
}

export { createBashTool } from './BashTool'
export {
  clearFileOpsCache,
  clearReadTracker,
  createFileSystemTools,
  getReadFilesSummary,
  notifyOtherToolCall,
  registerInternalBlockedDirectories,
  resetFileDedup
} from './FileSystemTool'
export { createPowerShellTool } from './PowerShellTool'

export type {
  PostToolUseHook,
  PostToolUseHookContext,
  PostToolUseHookResult,
  PreToolUseHook,
  PreToolUseHookContext,
  PreToolUseHookResult,
  ShellCommandRunner,
  ShellExecutionOutput,
  ShellExecutionRequest,
  ShellPermissionDecision,
  ShellPermissionOptions,
  ShellRule,
  ShellToolOptions
} from './ShellTool'
export type {
  Tool,
  ToolExecuteResult,
  ToolFactory,
  ToolInputSchema,
  ToolResultTextBlock
} from './types'
export type { BudgetConfig, PersistedResult } from './budget'
export {
  DEFAULT_BUDGET,
  enforceTurnBudget,
  maybePersistToolResult,
  resolveThreshold,
  withResultPersistence
} from './budget'
