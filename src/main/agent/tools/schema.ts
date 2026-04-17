import { z, type ZodTypeAny } from 'zod'

import { ToolExecutionError } from './fault-tolerance'
import type { Tool, ToolExecuteResult, ToolInputSchema } from './types'

export type LazyToolSchema<TSchema extends ZodTypeAny = ZodTypeAny> = () => TSchema

export function lazySchema<TSchema extends ZodTypeAny>(
  factory: () => TSchema
): LazyToolSchema<TSchema> {
  let cached: TSchema | undefined

  return () => {
    if (!cached) {
      cached = factory()
    }

    return cached
  }
}

export const toolResultTextBlockSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string()
})

export const toolExecuteResultSchema = z.strictObject({
  content: z.array(toolResultTextBlockSchema),
  details: z.object({ summary: z.string() }).catchall(z.unknown())
})

type InferLazySchema<TSchema extends LazyToolSchema> = z.infer<ReturnType<TSchema>>

type ToolDefinition<
  TInputSchema extends LazyToolSchema,
  TOutputSchema extends LazyToolSchema<z.ZodType<ToolExecuteResult>>
> = {
  name: string
  label: string
  description: string
  priority?: number
  idempotent?: boolean
  inputSchema: TInputSchema
  outputSchema: TOutputSchema
  faultTolerance?: Tool['faultTolerance']
  validateResult?: Tool['validateResult']
  selfHeal?: Tool['selfHeal']
  fallback?: Tool['fallback']
  execute: (toolCallId: string, params: InferLazySchema<TInputSchema>) => Promise<ToolExecuteResult>
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      return `${field}: ${issue.message}`
    })
    .join('; ')
}

function toToolInputSchema(schema: ZodTypeAny): ToolInputSchema {
  const { $schema: _jsonSchemaVersion, ...jsonSchema } = z.toJSONSchema(schema) as Record<
    string,
    unknown
  >
  if (jsonSchema.type !== 'object') {
    throw new Error('Tool input schema must serialize to a JSON object schema.')
  }

  return jsonSchema as ToolInputSchema
}

export function defineTool<
  TInputSchema extends LazyToolSchema,
  TOutputSchema extends LazyToolSchema<z.ZodType<ToolExecuteResult>>
>(definition: ToolDefinition<TInputSchema, TOutputSchema>): Tool {
  const inputSchema = definition.inputSchema()
  const outputSchema = definition.outputSchema()

  return {
    name: definition.name,
    label: definition.label,
    description: definition.description,
    priority: definition.priority,
    idempotent: definition.idempotent,
    inputSchema: toToolInputSchema(inputSchema),
    faultTolerance: definition.faultTolerance,
    validateResult: definition.validateResult,
    selfHeal: definition.selfHeal,
    fallback: definition.fallback,
    execute: async (toolCallId, params) => {
      const parsedInput = inputSchema.safeParse(params)
      if (!parsedInput.success) {
        throw new ToolExecutionError({
          code: 'TOOL_BAD_INPUT',
          type: 'parameter',
          stage: 'input_validation',
          retryable: false,
          message: `Invalid input for tool "${definition.name}": ${formatZodError(parsedInput.error)}`
        })
      }

      const validInput = parsedInput.data as InferLazySchema<TInputSchema>
      const result = await definition.execute(toolCallId, validInput)
      const parsedOutput = outputSchema.safeParse(result)
      if (!parsedOutput.success) {
        throw new ToolExecutionError({
          code: 'TOOL_OUTPUT_INVALID',
          type: 'result_invalid',
          stage: 'output_validation',
          retryable: true,
          message: `Invalid output for tool "${definition.name}": ${formatZodError(parsedOutput.error)}`
        })
      }

      return parsedOutput.data
    }
  }
}
