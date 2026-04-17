import { setTimeout as delay } from 'node:timers/promises'

import type {
  Tool,
  ToolErrorCode,
  ToolErrorType,
  ToolExecuteResult,
  ToolExecutionContext,
  ToolFailureStage,
  ToolFault,
  ToolValidationStatus
} from './types'

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_BASE_DELAY_MS = 250
const DEFAULT_MAX_JITTER_MS = 250
const DEFAULT_TIMEOUT_MS = 10_000

const RETRYABLE_CODES = new Set<ToolErrorCode>([
  'TOOL_TIMEOUT',
  'TOOL_RATE_LIMITED',
  'TOOL_NETWORK',
  'TOOL_UNAVAILABLE',
  'TOOL_RESULT_INVALID'
])

const RETRYABLE_MESSAGE_PATTERNS: Array<{ code: ToolErrorCode; pattern: RegExp }> = [
  { code: 'TOOL_RATE_LIMITED', pattern: /\b429\b|rate limit|too many requests/i },
  { code: 'TOOL_TIMEOUT', pattern: /timed?\s*out|timeout|etimedout/i },
  {
    code: 'TOOL_NETWORK',
    pattern: /network|econnreset|econnrefused|enotfound|ehostunreach|socket hang up/i
  },
  { code: 'TOOL_PERMISSION_DENIED', pattern: /\b403\b|forbidden|permission denied|eacces|eperm/i },
  { code: 'TOOL_NOT_FOUND', pattern: /\b404\b|not found|enoent|no such file/i },
  { code: 'TOOL_BAD_INPUT', pattern: /invalid input|must be|required|unexpected input|schema/i },
  { code: 'TOOL_OUTPUT_INVALID', pattern: /invalid output|output.*schema/i },
  {
    code: 'TOOL_UNAVAILABLE',
    pattern: /\b5\d\d\b|service unavailable|failed to start|unavailable/i
  }
]

export type ToolExecutionOutcome = {
  result: ToolExecuteResult
  isError: boolean
  fault?: ToolFault
  attemptCount: number
  retryCount: number
  selfHealCount: number
  fallbackUsed: boolean
  fallbackStrategy?: string
  validationStatus: ToolValidationStatus
}

export class ToolExecutionError extends Error {
  readonly fault: ToolFault

  constructor(fault: ToolFault) {
    super(fault.message)
    this.name = 'ToolExecutionError'
    this.fault = fault
  }
}

type TimeoutError = Error & { code?: string }

type StructuredToolPayload = {
  error?: unknown
  ok?: unknown
  blocked?: unknown
  reason?: unknown
  timed_out?: unknown
  failed_to_start?: unknown
  exit_code?: unknown
  stderr?: unknown
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

const toRetryable = (code: ToolErrorCode, explicit?: boolean): boolean =>
  explicit ?? RETRYABLE_CODES.has(code)

const buildFault = (
  code: ToolErrorCode,
  type: ToolErrorType,
  stage: ToolFailureStage,
  message: string,
  details?: Record<string, unknown>,
  retryable?: boolean
): ToolFault => ({
  code,
  type,
  stage,
  retryable: toRetryable(code, retryable),
  message,
  details
})

const compact = (value: string, max = 240): string => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return ''
  }

  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`
}

const toTimeoutError = (toolName: string, timeoutMs: number): TimeoutError => {
  const error = new Error(`${toolName} timed out after ${timeoutMs}ms.`) as TimeoutError
  error.code = 'ETIMEDOUT'
  return error
}

const resolveErrorCode = (message: string): ToolErrorCode => {
  for (const entry of RETRYABLE_MESSAGE_PATTERNS) {
    if (entry.pattern.test(message)) {
      return entry.code
    }
  }

  return 'TOOL_EXECUTION_FAILED'
}

const resolveErrorType = (code: ToolErrorCode): ToolErrorType => {
  switch (code) {
    case 'TOOL_TIMEOUT':
    case 'TOOL_RATE_LIMITED':
    case 'TOOL_NETWORK':
      return 'transient'
    case 'TOOL_BAD_INPUT':
      return 'parameter'
    case 'TOOL_PERMISSION_DENIED':
      return 'permission'
    case 'TOOL_NOT_FOUND':
      return 'not_found'
    case 'TOOL_UNAVAILABLE':
      return 'tool_unavailable'
    case 'TOOL_OUTPUT_INVALID':
    case 'TOOL_RESULT_INVALID':
      return 'result_invalid'
    case 'TOOL_EXECUTION_FAILED':
      return 'execution'
    default:
      return 'unknown'
  }
}

const resolveFailureStage = (code: ToolErrorCode): ToolFailureStage => {
  switch (code) {
    case 'TOOL_BAD_INPUT':
      return 'input_validation'
    case 'TOOL_TIMEOUT':
      return 'timeout'
    case 'TOOL_OUTPUT_INVALID':
      return 'output_validation'
    case 'TOOL_RESULT_INVALID':
      return 'result_validation'
    default:
      return 'execution'
  }
}

const detectStructuredToolPayloadError = (
  result: ToolExecuteResult
): ToolExecutionError | undefined => {
  const text = result.content
    .map((item) => item.text)
    .join('\n')
    .trim()
  if (!text.startsWith('{')) {
    return undefined
  }

  let payload: StructuredToolPayload
  try {
    payload = JSON.parse(text) as StructuredToolPayload
  } catch {
    return undefined
  }

  if (typeof payload.error === 'string' && payload.error.trim()) {
    const message = payload.error.trim()
    const code = resolveErrorCode(message)
    return new ToolExecutionError(
      buildFault(code, resolveErrorType(code), resolveFailureStage(code), message, {
        payload
      })
    )
  }

  if (payload.ok === false) {
    let code: ToolErrorCode = 'TOOL_EXECUTION_FAILED'
    let message =
      asString(payload.reason) ||
      asString(payload.stderr) ||
      `Tool execution failed with exit code ${String(payload.exit_code ?? 'unknown')}.`

    if (payload.blocked === true) {
      code = 'TOOL_PERMISSION_DENIED'
    } else if (payload.timed_out === true) {
      code = 'TOOL_TIMEOUT'
    } else if (payload.failed_to_start === true) {
      code = 'TOOL_UNAVAILABLE'
    } else {
      code = resolveErrorCode(message)
    }

    return new ToolExecutionError(
      buildFault(code, resolveErrorType(code), resolveFailureStage(code), message, { payload })
    )
  }

  return undefined
}

const normalizeToolError = (error: unknown): ToolFault => {
  if (error instanceof ToolExecutionError) {
    return error.fault
  }

  const message = error instanceof Error ? error.message : String(error)
  const code = resolveErrorCode(message)
  return buildFault(code, resolveErrorType(code), resolveFailureStage(code), message, undefined)
}

const withTimeout = async <T>(
  promise: Promise<T>,
  toolName: string,
  timeoutMs: number
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(toTimeoutError(toolName, timeoutMs)), timeoutMs)
      })
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

const buildErrorResult = (
  toolName: string,
  fault: ToolFault,
  attemptCount: number,
  retryCount: number,
  selfHealCount: number,
  validationStatus: ToolValidationStatus
): ToolExecuteResult => {
  const payload = {
    ok: false,
    tool: toolName,
    error_code: fault.code,
    error_type: fault.type,
    failure_stage: fault.stage,
    retryable: fault.retryable,
    attempt_count: attemptCount,
    retry_count: retryCount,
    self_heal_count: selfHealCount,
    validation_status: validationStatus,
    message: fault.message,
    details: fault.details ?? null
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    details: {
      summary: `${toolName} failed [${fault.code}]: ${compact(fault.message, 180)}`
    }
  }
}

const shouldRetry = (
  tool: Tool,
  fault: ToolFault,
  attemptCount: number,
  maxAttempts: number
): boolean => {
  if (attemptCount >= maxAttempts) {
    return false
  }

  if (!tool.idempotent) {
    return false
  }

  return fault.retryable
}

const computeDelayMs = (attempt: number, baseDelayMs: number, maxJitterMs: number): number =>
  baseDelayMs * 2 ** Math.max(0, attempt - 1) + Math.floor(Math.random() * maxJitterMs)

const buildContext = (
  tool: Tool,
  toolCallId: string,
  params: Record<string, unknown>,
  attempt: number,
  maxAttempts: number,
  fault: ToolFault
): ToolExecutionContext => ({
  toolCallId,
  toolName: tool.name,
  params,
  attempt,
  maxAttempts,
  fault
})

const resolveTimeoutMs = (tool: Tool, params: Record<string, unknown>): number => {
  const dynamicTimeout = tool.faultTolerance?.resolveTimeoutMs?.(params)
  const configuredTimeout = tool.faultTolerance?.timeoutMs
  const candidate = dynamicTimeout ?? configuredTimeout ?? DEFAULT_TIMEOUT_MS

  if (!Number.isFinite(candidate) || candidate <= 0) {
    return DEFAULT_TIMEOUT_MS
  }

  return Math.floor(candidate)
}

export async function executeToolWithFaultTolerance(
  tool: Tool,
  toolCallId: string,
  params: Record<string, unknown>
): Promise<ToolExecutionOutcome> {
  const maxRetries = Math.max(0, Math.floor(tool.faultTolerance?.maxRetries ?? DEFAULT_MAX_RETRIES))
  const maxAttempts = maxRetries + 1
  const baseDelayMs = Math.max(
    0,
    Math.floor(tool.faultTolerance?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS)
  )
  const maxJitterMs = Math.max(
    0,
    Math.floor(tool.faultTolerance?.maxJitterMs ?? DEFAULT_MAX_JITTER_MS)
  )

  let currentParams = params
  let attemptCount = 0
  let retryCount = 0
  let selfHealCount = 0
  let validationStatus: ToolValidationStatus = tool.validateResult ? 'passed' : 'skipped'

  while (attemptCount < maxAttempts) {
    attemptCount += 1
    validationStatus = tool.validateResult ? 'passed' : 'skipped'

    try {
      const timeoutMs = resolveTimeoutMs(tool, currentParams)
      const result = await withTimeout(
        tool.execute(toolCallId, currentParams),
        tool.name,
        timeoutMs
      )
      const structuredFault = detectStructuredToolPayloadError(result)
      if (structuredFault) {
        throw structuredFault
      }

      const validation = await tool.validateResult?.(result, currentParams)
      if (validation && !validation.ok) {
        validationStatus = 'failed_semantic'
        throw new ToolExecutionError(
          buildFault(
            validation.code ?? 'TOOL_RESULT_INVALID',
            'result_invalid',
            'result_validation',
            validation.message,
            validation.details,
            true
          )
        )
      }

      return {
        result,
        isError: false,
        attemptCount,
        retryCount,
        selfHealCount,
        fallbackUsed: false,
        validationStatus
      }
    } catch (error) {
      const fault = normalizeToolError(error)
      if (fault.code === 'TOOL_OUTPUT_INVALID') {
        validationStatus = 'failed_schema'
      }

      if (tool.selfHeal) {
        try {
          const healed = await tool.selfHeal(
            buildContext(tool, toolCallId, currentParams, attemptCount, maxAttempts, fault)
          )
          if (healed?.params) {
            currentParams = healed.params
            selfHealCount += 1
            retryCount += 1
            continue
          }
        } catch {
          // Ignore self-heal failures and fall back to normal handling.
        }
      }

      if (shouldRetry(tool, fault, attemptCount, maxAttempts)) {
        retryCount += 1
        await delay(computeDelayMs(attemptCount, baseDelayMs, maxJitterMs))
        continue
      }

      if (tool.fallback) {
        try {
          const fallback = await tool.fallback(
            buildContext(tool, toolCallId, currentParams, attemptCount, maxAttempts, fault)
          )
          if (fallback) {
            return {
              result: fallback.result,
              isError: false,
              fault,
              attemptCount,
              retryCount,
              selfHealCount,
              fallbackUsed: true,
              fallbackStrategy: fallback.strategy,
              validationStatus
            }
          }
        } catch {
          // Ignore fallback failures and return the original fault.
        }
      }

      return {
        result: buildErrorResult(
          tool.name,
          fault,
          attemptCount,
          retryCount,
          selfHealCount,
          validationStatus
        ),
        isError: true,
        fault,
        attemptCount,
        retryCount,
        selfHealCount,
        fallbackUsed: false,
        validationStatus
      }
    }
  }

  const fault = buildFault(
    'TOOL_UNKNOWN',
    'unknown',
    'execution',
    `${tool.name} exhausted execution attempts.`,
    undefined,
    false
  )

  return {
    result: buildErrorResult(
      tool.name,
      fault,
      attemptCount,
      retryCount,
      selfHealCount,
      validationStatus
    ),
    isError: true,
    fault,
    attemptCount,
    retryCount,
    selfHealCount,
    fallbackUsed: false,
    validationStatus
  }
}
