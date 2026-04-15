import os from 'node:os'
import process from 'node:process'
import { clampText } from './text-utils'

export type ReadOnlyTool = {
  name: string
  label: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
  }
  execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{
    content: Array<{ type: 'text'; text: string }>
    details: { summary: string }
  }>
}

export const createReadOnlyTools = (): ReadOnlyTool[] => [
  {
    name: 'get_time',
    label: 'Current Time',
    description: 'Return the current local time, timezone, and ISO timestamp.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
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
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
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
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to echo back.'
        }
      },
      required: ['text'],
      additionalProperties: false
    },
    execute: async (_toolCallId, params) => {
      const text = clampText(params.text, 400)

      return {
        content: [{ type: 'text', text }],
        details: { summary: text }
      }
    }
  }
]
