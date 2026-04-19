import {
  getPersistentMemoryRepository,
  type PersistentMemoryOperationResult,
  type PersistentMemoryRepository
} from '../../memory'
import { getToolPriority } from '../priorities'
import { defineTool, lazySchema, toolExecuteResultSchema } from '../schema'
import type { Tool, ToolExecuteResult } from '../types'
import { memoryToolInputSchema } from './input'

const memoryToolOutputSchema = lazySchema(() => toolExecuteResultSchema)

type CreateMemoryToolOptions = {
  repository?: PersistentMemoryRepository
}

const toToolPayload = (result: PersistentMemoryOperationResult): string =>
  JSON.stringify(
    {
      success: result.success,
      changed: result.changed,
      action: result.action,
      target: result.target,
      message: result.message,
      error: result.error,
      code: result.code,
      entries: result.entries,
      usage: result.usage,
      projected_usage: result.projectedUsage
    },
    null,
    2
  )

export function createMemoryTool(options: CreateMemoryToolOptions = {}): Tool {
  const repository = options.repository ?? getPersistentMemoryRepository()

  return defineTool({
    name: 'memory',
    label: 'Persistent Memory',
    description:
      'Manage cross-session persistent memory. Actions: add, replace, remove. ' +
      'Targets: memory (environment/project notes) and user (user preferences/profile). ' +
      'There is no read action: MEMORY.md and USER.md are injected into the system prompt at ' +
      'chat-session start as a frozen snapshot. Tool responses always show live disk state, ' +
      'which may differ from the current session prompt if memory changed mid-session.',
    inputSchema: memoryToolInputSchema,
    outputSchema: memoryToolOutputSchema,
    priority: getToolPriority('memory'),
    execute: async (_toolCallId, params): Promise<ToolExecuteResult> => {
      const result = await repository.applyOperation({
        action: params.action,
        target: params.target,
        content: params.content,
        oldText: params.old_text
      })
      const text = toToolPayload(result)
      const summary = result.success
        ? `memory ${result.action}: ${result.message ?? 'ok'}`
        : `memory ${result.action} failed: ${result.error ?? 'unknown error'}`

      return {
        content: [{ type: 'text', text }],
        details: { summary }
      }
    }
  })
}
