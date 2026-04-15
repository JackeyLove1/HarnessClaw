import type { AnthropicSettings, ConnectionCheckResult } from '@shared/types'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { createChatRuntime } from '../chat/runtime'

const ANTHROPIC_BASE_URL_KEY = 'ANTHROPIC_BASE_URL'
const ANTHROPIC_API_KEY = 'ANTHROPIC_API_KEY'
const PROVIDER_KEY = 'NOTEMARK_MODEL_PROVIDER'
const MODEL_KEY = 'NOTEMARK_MODEL'

const deepclawEnvPath = join(os.homedir(), '.deepclaw', '.env')

const parseEnvEntries = (source: string): Map<string, string> => {
  const entries = new Map<string, string>()
  const lines = source.split(/\r?\n/)

  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue

    const [, key, rawValue] = match
    const value =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue
    entries.set(key, value)
  }

  return entries
}

const formatValue = (value: string): string => {
  if (!value) return '""'
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value

  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

const ensureDeepclawEnvFile = async (): Promise<void> => {
  await fs.mkdir(dirname(deepclawEnvPath), { recursive: true })

  try {
    await fs.access(deepclawEnvPath)
  } catch {
    await fs.writeFile(deepclawEnvPath, '', 'utf8')
  }
}

const readDeepclawEnvFile = async (): Promise<string> => {
  await ensureDeepclawEnvFile()
  return fs.readFile(deepclawEnvPath, 'utf8')
}

const writeDeepclawEnvFile = async (source: string): Promise<void> => {
  await ensureDeepclawEnvFile()
  await fs.writeFile(deepclawEnvPath, source, 'utf8')
}

const buildUpdatedEnv = (currentEnvSource: string, updates: Record<string, string>): string => {
  const lines = currentEnvSource.split(/\r?\n/)
  const handled = new Set<string>()
  const nextLines = lines.map((line) => {
    const match = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/)
    if (!match) return line

    const [, prefix, key, separator] = match
    const nextValue = updates[key]
    if (nextValue == null) return line
    handled.add(key)
    return `${prefix}${key}${separator}${formatValue(nextValue)}`
  })

  for (const [key, value] of Object.entries(updates)) {
    if (!handled.has(key)) {
      nextLines.push(`${key}=${formatValue(value)}`)
    }
  }

  const output = nextLines.join('\n')
  return output.endsWith('\n') ? output : `${output}\n`
}

const applySettingsToProcessEnv = (settings: AnthropicSettings): void => {
  process.env[ANTHROPIC_BASE_URL_KEY] = settings.baseUrl
  process.env[ANTHROPIC_API_KEY] = settings.apiKey
  process.env[MODEL_KEY] = settings.model
  process.env[PROVIDER_KEY] = 'anthropic'
}

export const getAnthropicSettings = async (): Promise<AnthropicSettings> => {
  const source = await readDeepclawEnvFile()
  const envEntries = parseEnvEntries(source)

  return {
    baseUrl: envEntries.get(ANTHROPIC_BASE_URL_KEY) ?? '',
    apiKey: envEntries.get(ANTHROPIC_API_KEY) ?? '',
    model: envEntries.get(MODEL_KEY) ?? ''
  }
}

export const saveAnthropicSettings = async (
  settings: AnthropicSettings
): Promise<AnthropicSettings> => {
  const nextSettings: AnthropicSettings = {
    baseUrl: settings.baseUrl.trim(),
    apiKey: settings.apiKey.trim(),
    model: settings.model.trim()
  }

  if (!nextSettings.baseUrl) {
    throw new Error('Base URL 不能为空。')
  }

  if (!nextSettings.apiKey) {
    throw new Error('API Key 不能为空。')
  }

  if (!nextSettings.model) {
    throw new Error('Model Name 不能为空。')
  }

  const source = await readDeepclawEnvFile()
  const nextSource = buildUpdatedEnv(source, {
    [ANTHROPIC_BASE_URL_KEY]: nextSettings.baseUrl,
    [ANTHROPIC_API_KEY]: nextSettings.apiKey,
    [MODEL_KEY]: nextSettings.model,
    [PROVIDER_KEY]: 'anthropic'
  })
  await writeDeepclawEnvFile(nextSource)
  applySettingsToProcessEnv(nextSettings)

  return nextSettings
}

export const hydrateAnthropicSettings = async (): Promise<void> => {
  const settings = await getAnthropicSettings()
  if (!settings.baseUrl || !settings.apiKey) return

  applySettingsToProcessEnv(settings)
}

const withTemporaryAnthropicEnv = async <T>(
  settings: AnthropicSettings,
  task: () => Promise<T>
): Promise<T> => {
  const previousValues = {
    [ANTHROPIC_BASE_URL_KEY]: process.env[ANTHROPIC_BASE_URL_KEY],
    [ANTHROPIC_API_KEY]: process.env[ANTHROPIC_API_KEY],
    [PROVIDER_KEY]: process.env[PROVIDER_KEY],
    [MODEL_KEY]: process.env[MODEL_KEY]
  }

  process.env[ANTHROPIC_BASE_URL_KEY] = settings.baseUrl
  process.env[ANTHROPIC_API_KEY] = settings.apiKey
  process.env[MODEL_KEY] = settings.model
  process.env[PROVIDER_KEY] = 'anthropic'

  try {
    return await task()
  } finally {
    for (const [key, value] of Object.entries(previousValues)) {
      if (typeof value === 'undefined') {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

export const testAnthropicConnection = async (
  settings: AnthropicSettings
): Promise<ConnectionCheckResult> => {
  const sanitized: AnthropicSettings = {
    baseUrl: settings.baseUrl.trim(),
    apiKey: settings.apiKey.trim(),
    model: settings.model.trim()
  }

  if (!sanitized.baseUrl) {
    throw new Error('Base URL 不能为空。')
  }

  if (!sanitized.apiKey) {
    throw new Error('API Key 不能为空。')
  }

  if (!sanitized.model) {
    throw new Error('Model Name 不能为空。')
  }

  return withTemporaryAnthropicEnv(sanitized, async () => {
    const runtime = createChatRuntime()
    return runtime.testConnection()
  })
}
