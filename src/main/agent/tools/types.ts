export type ToolResultTextBlock = {
  type: 'text'
  text: string
}
export type ToolExecuteResult = {
  content: ToolResultTextBlock[]
  details: { summary: string; [key: string]: unknown }
}

export type ToolInputSchema = Record<string, unknown> & {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export type Tool = {
  name: string
  label: string
  description: string
  inputSchema: ToolInputSchema
  priority?: number
  execute: (toolCallId: string, params: Record<string, unknown>) => Promise<ToolExecuteResult>
}

export type ToolFactory = () => Tool
