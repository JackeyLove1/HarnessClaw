import { afterEach, describe, expect, it } from 'vitest'
import { getApiKey, resolveRuntimeConfig } from './config'

const ORIGINAL_ENV = { ...process.env }

const resetEnv = (): void => {
  for (const key of Object.keys(process.env)) {
    delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

afterEach(() => {
  resetEnv()
})

describe('runtime config', () => {
  it('infers openai provider/model from API key', () => {
    process.env.OPENAI_API_KEY = 'openai-test-key'
    delete process.env.NOTEMARK_MODEL_PROVIDER
    delete process.env.NOTEMARK_MODEL

    expect(resolveRuntimeConfig()).toEqual({
      provider: 'openai',
      model: 'gpt-4.1-mini'
    })
  })

  it('throws when provider cannot be resolved', () => {
    delete process.env.NOTEMARK_MODEL_PROVIDER
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.NOTEMARK_MODEL

    expect(() => resolveRuntimeConfig()).toThrow(/Chat runtime is not configured/)
  })

  it('throws when configured openai provider is missing api key', () => {
    process.env.NOTEMARK_MODEL_PROVIDER = 'openai'
    process.env.NOTEMARK_MODEL = 'gpt-4.1-mini'
    delete process.env.OPENAI_API_KEY

    expect(() => resolveRuntimeConfig()).toThrow(/missing OPENAI_API_KEY/)
  })

  it('throws when configured anthropic provider is missing api key', () => {
    process.env.NOTEMARK_MODEL_PROVIDER = 'anthropic'
    process.env.NOTEMARK_MODEL = 'claude-sonnet-4-20250514'
    delete process.env.ANTHROPIC_API_KEY

    expect(() => resolveRuntimeConfig()).toThrow(/missing ANTHROPIC_API_KEY/)
  })

  it('returns explicit provider/model and key lookup', () => {
    process.env.NOTEMARK_MODEL_PROVIDER = 'anthropic'
    process.env.NOTEMARK_MODEL = 'claude-sonnet-4-20250514'
    process.env.ANTHROPIC_API_KEY = 'anthropic-key'

    expect(resolveRuntimeConfig()).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514'
    })
    expect(getApiKey('anthropic')).toBe('anthropic-key')
  })
})
