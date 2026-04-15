import { afterEach, describe, expect, it } from 'vitest'
import { getAnthropicApiKey, resolveRuntimeConfig } from './config'

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
  it('throws when anthropic model is missing in env', () => {
    process.env.ANTHROPIC_API_KEY = 'anthropic-test-key'
    delete process.env.NOTEMARK_MODEL_PROVIDER
    delete process.env.NOTEMARK_MODEL

    expect(() => resolveRuntimeConfig()).toThrow(/missing NOTEMARK_MODEL/)
  })

  it('throws when anthropic provider is missing api key', () => {
    delete process.env.NOTEMARK_MODEL_PROVIDER
    delete process.env.ANTHROPIC_API_KEY

    expect(() => resolveRuntimeConfig()).toThrow(/missing ANTHROPIC_API_KEY/)
  })

  it('throws when provider is explicitly set to non-anthropic', () => {
    process.env.NOTEMARK_MODEL_PROVIDER = 'openai'
    process.env.ANTHROPIC_API_KEY = 'anthropic-key'

    expect(() => resolveRuntimeConfig()).toThrow(/only supports Anthropic provider/)
  })

  it('returns explicit anthropic provider/model and key lookup', () => {
    process.env.NOTEMARK_MODEL_PROVIDER = 'anthropic'
    process.env.NOTEMARK_MODEL = 'claude-sonnet-4-5'
    process.env.ANTHROPIC_API_KEY = 'anthropic-key'
    process.env.ANTHROPIC_BASE_URL = 'https://example-proxy.test/v1'

    expect(resolveRuntimeConfig()).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      baseUrl: 'https://example-proxy.test/v1'
    })
    expect(getAnthropicApiKey()).toBe('anthropic-key')
  })
})
