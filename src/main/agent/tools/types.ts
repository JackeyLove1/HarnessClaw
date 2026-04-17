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

export type ToolErrorType =
  | 'transient'
  | 'parameter'
  | 'permission'
  | 'not_found'
  | 'tool_unavailable'
  | 'result_invalid'
  | 'execution'
  | 'unknown'

export type ToolErrorCode =
  | 'TOOL_TIMEOUT'
  | 'TOOL_RATE_LIMITED'
  | 'TOOL_NETWORK'
  | 'TOOL_BAD_INPUT'
  | 'TOOL_PERMISSION_DENIED'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_UNAVAILABLE'
  | 'TOOL_OUTPUT_INVALID'
  | 'TOOL_RESULT_INVALID'
  | 'TOOL_EXECUTION_FAILED'
  | 'TOOL_UNKNOWN'

export type ToolFailureStage =
  | 'input_validation'
  | 'execution'
  | 'timeout'
  | 'output_validation'
  | 'result_validation'
  | 'fallback'

export type ToolValidationStatus = 'skipped' | 'passed' | 'failed_schema' | 'failed_semantic'

export type ToolFault = {
  code: ToolErrorCode
  type: ToolErrorType
  stage: ToolFailureStage
  retryable: boolean
  message: string
  details?: Record<string, unknown>
}

export type ToolFaultTolerancePolicy = {
  maxRetries?: number
  baseDelayMs?: number
  maxJitterMs?: number
  timeoutMs?: number
  resolveTimeoutMs?: (params: Record<string, unknown>) => number | undefined
}

export type ToolValidationResult =
  | {
      ok: true
      summary?: string
      details?: Record<string, unknown>
    }
  | {
      ok: false
      code?: ToolErrorCode
      message: string
      summary?: string
      details?: Record<string, unknown>
    }

export type ToolExecutionContext = {
  toolCallId: string
  toolName: string
  params: Record<string, unknown>
  attempt: number
  maxAttempts: number
  fault: ToolFault
}

export type ToolSelfHealResult = {
  params: Record<string, unknown>
  reason: string
}

export type ToolFallbackResult = {
  result: ToolExecuteResult
  strategy: string
}

export type Tool = {
  name: string
  label: string
  description: string
  inputSchema: ToolInputSchema
  priority?: number
  idempotent?: boolean
  faultTolerance?: ToolFaultTolerancePolicy
  validateResult?: (
    result: ToolExecuteResult,
    params: Record<string, unknown>
  ) => Promise<ToolValidationResult | void> | ToolValidationResult | void
  selfHeal?: (
    context: ToolExecutionContext
  ) => Promise<ToolSelfHealResult | void> | ToolSelfHealResult | void
  fallback?: (
    context: ToolExecutionContext
  ) => Promise<ToolFallbackResult | void> | ToolFallbackResult | void
  execute: (toolCallId: string, params: Record<string, unknown>) => Promise<ToolExecuteResult>
}

export type ToolFactory = () => Tool
