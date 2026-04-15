import process from 'node:process'
import type { RuntimeConfig } from './types'

export const resolveRuntimeConfig = (): RuntimeConfig => {
  const provider =
    process.env.NOTEMARK_MODEL_PROVIDER ??
    (process.env.OPENAI_API_KEY
      ? 'openai'
      : process.env.ANTHROPIC_API_KEY
        ? 'anthropic'
        : undefined)
  const model =
    process.env.NOTEMARK_MODEL ??
    (provider === 'openai'
      ? 'gpt-4.1-mini'
      : provider === 'anthropic'
        ? 'claude-sonnet-4-20250514'
        : '')

  if (!provider) {
    throw new Error(
      'Chat runtime is not configured. Set NOTEMARK_MODEL_PROVIDER and NOTEMARK_MODEL, plus the matching provider API key.'
    )
  }

  if (!model) {
    throw new Error('Chat runtime is missing NOTEMARK_MODEL.')
  }

  if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
    throw new Error('Chat runtime is missing OPENAI_API_KEY for the configured OpenAI model.')
  }

  if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('Chat runtime is missing ANTHROPIC_API_KEY for the configured Anthropic model.')
  }

  return { provider, model }
}

export const getApiKey = (provider: string): string | undefined => {
  if (provider === 'openai') return process.env.OPENAI_API_KEY
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY
  return undefined
}
