import { execFile } from 'node:child_process'
import type { ExecFileOptions } from 'node:child_process'

import { z } from 'zod'

import { getToolPriority } from '../priorities'
import { resolveDefaultWorkingDir } from '../../utils'
import type { Tool, ToolExecuteResult } from '../types'
import { defineTool, lazySchema, toolExecuteResultSchema } from '../schema'
import { clampSummary, jsonResult, redactSensitiveText } from '../FileSystemTool/utils'

const DEFAULT_TIMEOUT_MS = 20_000
const MAX_TIMEOUT_MS = 300_000
const MAX_BUFFER_BYTES = 2 * 1024 * 1024
const MAX_OUTPUT_CHARS = 12_000
const DEFAULT_WORKING_DIR_LABEL = '~/.deepclaw'

export type ShellRule = {
  name: string
  reason: string
  pattern?: RegExp
  test?: (command: string) => boolean
}

export type ShellPermissionOptions = {
  allowRules?: ShellRule[]
  denyRules?: ShellRule[]
}

export type ShellPermissionDecision =
  | {
      allowed: true
      source: 'allow_rule' | 'default_allow'
      matchedRule?: string
      reason?: string
    }
  | {
      allowed: false
      source: 'builtin_deny' | 'deny_rule'
      matchedRule?: string
      reason: string
    }

export type ShellExecutionRequest = {
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  shellExecutable: string
  shellArgs: string[]
}

export type ShellExecutionOutput = {
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  failedToStart: boolean
}

export type ShellCommandRunner = (request: ShellExecutionRequest) => Promise<ShellExecutionOutput>

export type PreToolUseHookContext = {
  toolCallId: string
  toolName: string
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  taskId: string
  permission: ShellPermissionDecision & { allowed: true }
}

export type PostToolUseHookContext = PreToolUseHookContext & {
  output: ShellExecutionOutput
  result: ToolExecuteResult
}

export type PreToolUseHookResult = {
  block?: boolean
  reason?: string
}

export type PostToolUseHookResult = {
  summary?: string
  details?: Record<string, unknown>
}

export type PreToolUseHook = (
  context: PreToolUseHookContext
) => Promise<PreToolUseHookResult | void> | PreToolUseHookResult | void

export type PostToolUseHook = (
  context: PostToolUseHookContext
) => Promise<PostToolUseHookResult | void> | PostToolUseHookResult | void

export type ShellToolOptions = ShellPermissionOptions & {
  description: string
  label: string
  name: string
  shellExecutable: string
  shellArgs: (command: string) => string[]
  permission: (command: string, options: ShellPermissionOptions) => ShellPermissionDecision
  preToolUseHooks?: PreToolUseHook[]
  postToolUseHooks?: PostToolUseHook[]
  runCommand?: ShellCommandRunner
}

function sanitizeOutput(text: string): string {
  return redactSensitiveText(text).slice(0, MAX_OUTPUT_CHARS)
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function compactSnippet(text: string, max = 240): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return ''
  }
  if (normalized.length <= max) {
    return normalized
  }
  return `${normalized.slice(0, max)}...`
}

function summarizeExecution(
  toolName: string,
  command: string,
  output: ShellExecutionOutput,
  blockedReason?: string
): string {
  if (blockedReason) {
    return `${toolName} blocked: ${blockedReason}`
  }

  const commandSnippet = compactSnippet(command, 120)
  const parts = [`${toolName} command: ${commandSnippet || '[empty]'}`]

  if (output.failedToStart) {
    parts.push('failed to start')
  } else if (output.timedOut) {
    parts.push(
      `timed out after execution start${output.exitCode === null ? '' : ` (exit ${output.exitCode})`}`
    )
  } else {
    parts.push(`exit ${output.exitCode ?? 'null'}`)
  }

  const stderrSnippet = compactSnippet(output.stderr)
  const stdoutSnippet = compactSnippet(output.stdout)
  if (stderrSnippet) {
    parts.push(`stderr: ${stderrSnippet}`)
  } else if (stdoutSnippet) {
    parts.push(`stdout: ${stdoutSnippet}`)
  }

  return clampSummary(parts.join(' | '), 1200)
}

const shellToolInputSchema = lazySchema(() =>
  z.strictObject({
    command: z.string().trim().min(1).describe('One non-interactive shell command to execute.'),
    cwd: z
      .string()
      .optional()
      .describe(`Working directory for the command (defaults to ${DEFAULT_WORKING_DIR_LABEL}).`),
    timeout_ms: z.coerce
      .number()
      .transform((value) => Math.floor(value))
      .pipe(z.number().int().min(1_000).max(MAX_TIMEOUT_MS))
      .optional()
      .describe(`Execution timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS}).`),
    env_overrides: z
      .record(z.string(), z.string())
      .optional()
      .describe('Optional environment variables merged on top of the current process env.'),
    task_id: z.string().optional()
  })
)

const shellToolOutputSchema = lazySchema(() => toolExecuteResultSchema)

async function defaultRunCommand(request: ShellExecutionRequest): Promise<ShellExecutionOutput> {
  return await new Promise((resolve) => {
    const options: ExecFileOptions = {
      cwd: request.cwd,
      env: request.env,
      timeout: request.timeoutMs,
      maxBuffer: MAX_BUFFER_BYTES,
      windowsHide: true
    }

    execFile(request.shellExecutable, request.shellArgs, options, (error, stdout, stderr) => {
      const typedError = error as
        | (Error & {
            code?: number | string
            signal?: NodeJS.Signals
            killed?: boolean
          })
        | null
      const failedToStart = Boolean(typedError) && typedError?.code === 'ENOENT'
      const timedOut =
        Boolean(typedError) &&
        (typedError?.code === 'ETIMEDOUT' || Boolean(typedError?.killed && typedError?.signal))
      const exitCode = typeof typedError?.code === 'number' ? typedError.code : 0

      resolve({
        stdout: sanitizeOutput(toText(stdout)),
        stderr: sanitizeOutput(toText(stderr) || (typedError?.message ?? '')),
        exitCode: error ? exitCode : 0,
        signal: typedError?.signal ?? null,
        timedOut,
        failedToStart
      })
    })
  })
}

function makeToolResult(
  text: string,
  summary: string,
  details: Record<string, unknown> = {}
): ToolExecuteResult {
  return {
    content: [{ type: 'text', text }],
    details: {
      summary,
      ...details
    }
  }
}

function evaluateRule(rule: ShellRule, command: string): boolean {
  if (rule.pattern && rule.pattern.test(command)) {
    return true
  }

  return rule.test ? rule.test(command) : false
}

export function evaluateShellPermission(
  command: string,
  options: ShellPermissionOptions & { builtInDenyRules: ShellRule[] }
): ShellPermissionDecision {
  for (const rule of options.builtInDenyRules) {
    if (evaluateRule(rule, command)) {
      return {
        allowed: false,
        source: 'builtin_deny',
        matchedRule: rule.name,
        reason: rule.reason
      }
    }
  }

  for (const rule of options.denyRules ?? []) {
    if (evaluateRule(rule, command)) {
      return {
        allowed: false,
        source: 'deny_rule',
        matchedRule: rule.name,
        reason: rule.reason
      }
    }
  }

  for (const rule of options.allowRules ?? []) {
    if (evaluateRule(rule, command)) {
      return {
        allowed: true,
        source: 'allow_rule',
        matchedRule: rule.name,
        reason: rule.reason
      }
    }
  }

  return {
    allowed: true,
    source: 'default_allow'
  }
}

export function createShellTool(options: ShellToolOptions): Tool {
  const runCommand = options.runCommand ?? defaultRunCommand

  return defineTool({
    name: options.name,
    label: options.label,
    description: options.description,
    priority: getToolPriority(options.name),
    faultTolerance: {
      maxRetries: 0,
      resolveTimeoutMs: (params) => {
        const value = params.timeout_ms
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
          return Math.floor(value)
        }
        if (typeof value === 'string' && value.trim()) {
          const parsed = Number(value)
          if (Number.isFinite(parsed) && parsed > 0) {
            return Math.floor(parsed)
          }
        }
        return DEFAULT_TIMEOUT_MS
      }
    },
    inputSchema: shellToolInputSchema,
    outputSchema: shellToolOutputSchema,
    execute: async (toolCallId, params) => {
      const command = params.command.trim()
      const cwd = params.cwd?.trim() || resolveDefaultWorkingDir()
      const timeoutMs = params.timeout_ms ?? DEFAULT_TIMEOUT_MS
      const taskId = params.task_id || 'default'
      const env = {
        ...process.env,
        ...(params.env_overrides ?? {})
      }

      const permission = options.permission(command, {
        allowRules: options.allowRules,
        denyRules: options.denyRules
      })

      if (!permission.allowed) {
        const payload = {
          ok: false,
          blocked: true,
          command,
          cwd,
          reason: permission.reason,
          source: permission.source,
          matched_rule: permission.matchedRule ?? null
        }
        return makeToolResult(
          jsonResult(payload),
          summarizeExecution(options.name, command, emptyExecutionOutput(), permission.reason),
          payload
        )
      }

      const hookContext: PreToolUseHookContext = {
        toolCallId,
        toolName: options.name,
        command,
        cwd,
        env,
        timeoutMs,
        taskId,
        permission
      }

      for (const hook of options.preToolUseHooks ?? []) {
        try {
          const hookResult = await hook(hookContext)
          if (hookResult?.block) {
            const reason = hookResult.reason || 'blocked by PreToolUseHook'
            const payload = {
              ok: false,
              blocked: true,
              command,
              cwd,
              reason,
              source: 'pre_hook'
            }
            return makeToolResult(
              jsonResult(payload),
              summarizeExecution(options.name, command, emptyExecutionOutput(), reason),
              payload
            )
          }
        } catch (error) {
          const reason = `PreToolUseHook failed: ${error instanceof Error ? error.message : String(error)}`
          const payload = {
            ok: false,
            blocked: true,
            command,
            cwd,
            reason,
            source: 'pre_hook_error'
          }
          return makeToolResult(
            jsonResult(payload),
            summarizeExecution(options.name, command, emptyExecutionOutput(), reason),
            payload
          )
        }
      }

      const output = await runCommand({
        command,
        cwd,
        env,
        timeoutMs,
        shellExecutable: options.shellExecutable,
        shellArgs: options.shellArgs(command)
      })

      const payload = {
        ok: !output.failedToStart && !output.timedOut && output.exitCode === 0,
        blocked: false,
        command,
        cwd,
        exit_code: output.exitCode,
        signal: output.signal,
        timed_out: output.timedOut,
        failed_to_start: output.failedToStart,
        stdout: output.stdout,
        stderr: output.stderr
      }

      let result = makeToolResult(
        jsonResult(payload),
        summarizeExecution(options.name, command, output),
        {
          ...payload,
          permission_source: permission.source,
          matched_rule: permission.matchedRule ?? null
        }
      )

      for (const hook of options.postToolUseHooks ?? []) {
        try {
          const hookResult = await hook({
            ...hookContext,
            output,
            result
          })
          if (hookResult?.summary) {
            result = {
              ...result,
              details: {
                ...result.details,
                summary: hookResult.summary
              }
            }
          }
          if (hookResult?.details) {
            result = {
              ...result,
              details: {
                ...result.details,
                ...hookResult.details
              }
            }
          }
        } catch (error) {
          result = {
            ...result,
            details: {
              ...result.details,
              post_hook_warning: error instanceof Error ? error.message : String(error)
            }
          }
        }
      }

      return result
    }
  })
}

function emptyExecutionOutput(): ShellExecutionOutput {
  return {
    stdout: '',
    stderr: '',
    exitCode: null,
    signal: null,
    timedOut: false,
    failedToStart: false
  }
}
