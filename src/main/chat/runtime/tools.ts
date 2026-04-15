import os from 'node:os'
import process from 'node:process'
import { clampText } from './text-utils'
import type { PiTypeRuntime } from './types'

type ReadOnlyTool = {
  name: string
  label: string
  description: string
  parameters: unknown
  execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{
    content: Array<{ type: 'text'; text: string }>
    details: { summary: string }
  }>
}

export const createReadOnlyTools = (Type: PiTypeRuntime): ReadOnlyTool[] => [
  {
    name: 'get_time',
    label: 'Current Time',
    description: 'Return the current local time, timezone, and ISO timestamp.',
    parameters: Type.Object({}),
    execute: async () => {
      const now = new Date()
      const text = [
        `Local time: ${now.toLocaleString()}`,
        `Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
        `ISO: ${now.toISOString()}`
      ].join('\n')

      return {
        content: [{ type: 'text', text }],
        details: { summary: text }
      }
    }
  },
  {
    name: 'get_system_info',
    label: 'System Info',
    description: 'Return read-only runtime information about the current desktop environment.',
    parameters: Type.Object({}),
    execute: async () => {
      const text = [
        `Platform: ${process.platform}`,
        `Arch: ${process.arch}`,
        `Node: ${process.version}`,
        `Hostname: ${os.hostname()}`,
        `Home: ${os.homedir()}`
      ].join('\n')

      return {
        content: [{ type: 'text', text }],
        details: { summary: text }
      }
    }
  },
  {
    name: 'echo',
    label: 'Echo',
    description: 'Echo text back for debugging tool rendering and event flow.',
    parameters: Type.Object({
      text: Type.String({ description: 'Text to echo back.' })
    }),
    execute: async (_toolCallId, params) => {
      const text = clampText(params.text, 400)

      return {
        content: [{ type: 'text', text }],
        details: { summary: text }
      }
    }
  }
]
