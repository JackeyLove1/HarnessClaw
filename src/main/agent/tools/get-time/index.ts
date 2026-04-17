import { z } from 'zod'

import { getToolPriority } from '../priorities'
import { defineTool, lazySchema, toolExecuteResultSchema } from '../schema'
import type { Tool } from '../types'

const getTimeInputSchema = lazySchema(() => z.strictObject({}))
const getTimeOutputSchema = lazySchema(() => toolExecuteResultSchema)

export function createGetTimeTool(): Tool {
  return defineTool({
    name: 'get_time',
    label: 'Current Time',
    description: 'Return the current local time, timezone, and ISO timestamp.',
    idempotent: true,
    faultTolerance: {
      maxRetries: 1,
      timeoutMs: 3_000
    },
    inputSchema: getTimeInputSchema,
    outputSchema: getTimeOutputSchema,
    priority: getToolPriority('get_time'),
    execute: async () => {
      const now = new Date()
      const text = [
        `Local time: ${now.toLocaleString()}`,
        `Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
        `ISO: ${now.toISOString()}`
      ].join('\n')

      return {
        content: [{ type: 'text' as const, text }],
        details: { summary: text }
      }
    }
  })
}
