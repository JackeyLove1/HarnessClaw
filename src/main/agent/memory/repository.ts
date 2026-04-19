import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveMemoriesDir } from '../utils'
import { scanMemoryEntry } from './security'
import type {
  PersistentMemoryAction,
  PersistentMemoryOperationRequest,
  PersistentMemoryOperationResult,
  PersistentMemoryPromptSnapshot,
  PersistentMemoryStoreConfig,
  PersistentMemoryStoreState,
  PersistentMemoryTarget,
  PersistentMemoryUsage
} from './types'

export const MEMORY_ENTRY_DELIMITER = '\u00A7'
const MEMORY_ENTRY_SEPARATOR = `\n\n${MEMORY_ENTRY_DELIMITER}\n\n`

export const DEFAULT_MEMORY_STORE_CONFIGS: Record<
  PersistentMemoryTarget,
  PersistentMemoryStoreConfig
> = {
  memory: {
    target: 'memory',
    fileName: 'MEMORY.md',
    promptTitle: 'MEMORY',
    promptDescription: 'your personal notes',
    charLimit: 2_200
  },
  user: {
    target: 'user',
    fileName: 'USER.md',
    promptTitle: 'USER PROFILE',
    promptDescription: 'user preferences and communication style',
    charLimit: 1_375
  }
}

const normalizeLineEndings = (value: string): string => value.replace(/\r\n/g, '\n')

const normalizeEntry = (value: string): string => normalizeLineEndings(value).trim()

const dedupeEntries = (entries: string[]): string[] => {
  const seen = new Set<string>()
  const normalizedEntries: string[] = []

  for (const entry of entries.map(normalizeEntry)) {
    if (!entry || seen.has(entry)) {
      continue
    }

    seen.add(entry)
    normalizedEntries.push(entry)
  }

  return normalizedEntries
}

export const parseMemoryEntries = (source: string): string[] => {
  const normalized = normalizeLineEndings(source).trim()
  if (!normalized) {
    return []
  }

  return normalized
    .split(/\n[ \t]*\u00A7[ \t]*\n/g)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export const renderMemoryEntries = (entries: string[]): string =>
  dedupeEntries(entries).join(MEMORY_ENTRY_SEPARATOR)

const createUsage = (usedChars: number, limit: number): PersistentMemoryUsage => ({
  usedChars,
  limit,
  remainingChars: Math.max(0, limit - usedChars),
  percent: limit <= 0 ? 100 : Math.min(100, Math.round((usedChars / limit) * 100)),
  text: `${usedChars}/${limit}`
})

type PersistentMemoryRepositoryOptions = {
  memoriesDir?: string
  storeConfigs?: Partial<Record<PersistentMemoryTarget, Partial<PersistentMemoryStoreConfig>>>
}

type MatchResult =
  | {
      ok: true
      index: number
    }
  | {
      ok: false
      error: string
      code: 'ambiguous_match' | 'not_found'
    }

type EntryValidationResult = { ok: true } | { ok: false; reason: string; code: 'security_blocked' }

export class PersistentMemoryRepository {
  private readonly memoriesDir: string

  private readonly storeConfigs: Record<PersistentMemoryTarget, PersistentMemoryStoreConfig>

  constructor(options: PersistentMemoryRepositoryOptions = {}) {
    this.memoriesDir = options.memoriesDir ?? resolveMemoriesDir()
    this.storeConfigs = {
      memory: {
        ...DEFAULT_MEMORY_STORE_CONFIGS.memory,
        ...options.storeConfigs?.memory
      },
      user: {
        ...DEFAULT_MEMORY_STORE_CONFIGS.user,
        ...options.storeConfigs?.user
      }
    }
  }

  async readStore(target: PersistentMemoryTarget): Promise<PersistentMemoryStoreState> {
    const config = this.getConfig(target)
    const filePath = path.join(this.memoriesDir, config.fileName)
    const source = await this.readStoreFile(filePath)
    const entries = parseMemoryEntries(source)
    const usedChars = renderMemoryEntries(entries).length

    return {
      target,
      filePath,
      entries,
      usage: createUsage(usedChars, config.charLimit)
    }
  }

  async createPromptSnapshot(): Promise<PersistentMemoryPromptSnapshot> {
    const stores = await Promise.all([
      this.readStore('memory'),
      this.readStore('user')
    ] satisfies Array<Promise<PersistentMemoryStoreState>>)

    const rendered = stores
      .filter((store) => store.entries.length > 0)
      .map((store) => this.renderPromptSection(store))
      .join('\n\n')
      .trim()

    return {
      rendered: rendered || null,
      stores
    }
  }

  async applyOperation(
    request: PersistentMemoryOperationRequest
  ): Promise<PersistentMemoryOperationResult> {
    const current = await this.readStore(request.target)

    switch (request.action) {
      case 'add':
        return this.addEntry(current, request.action, request.content ?? '')
      case 'replace':
        return this.replaceEntry(
          current,
          request.action,
          request.oldText ?? '',
          request.content ?? ''
        )
      case 'remove':
        return this.removeEntry(current, request.action, request.oldText ?? '')
      default:
        return {
          success: false,
          changed: false,
          action: request.action,
          target: request.target,
          entries: current.entries,
          usage: current.usage,
          error: `Unsupported memory action: ${String(request.action)}`
        }
    }
  }

  private async addEntry(
    current: PersistentMemoryStoreState,
    action: PersistentMemoryAction,
    rawContent: string
  ): Promise<PersistentMemoryOperationResult> {
    const content = normalizeEntry(rawContent)
    const validation = this.validateEntryContent(content)
    if (!validation.ok) {
      return this.fail(current, action, validation.reason, validation.code)
    }

    if (current.entries.includes(content)) {
      return {
        success: true,
        changed: false,
        action,
        target: current.target,
        entries: current.entries,
        usage: current.usage,
        code: 'duplicate',
        message: 'Entry already exists. No duplicate added.'
      }
    }

    const nextEntries = [...current.entries, content]
    const overflow = this.checkLimit(current.target, nextEntries)
    if (overflow) {
      return this.fail(current, action, overflow.error, 'limit_exceeded', overflow.projectedUsage)
    }

    return this.persistSuccess(current.target, action, nextEntries, 'Added memory entry.')
  }

  private async replaceEntry(
    current: PersistentMemoryStoreState,
    action: PersistentMemoryAction,
    oldText: string,
    rawContent: string
  ): Promise<PersistentMemoryOperationResult> {
    const match = this.findUniqueMatch(current.entries, oldText)
    if (!match.ok) {
      return this.fail(current, action, match.error, match.code)
    }

    const content = normalizeEntry(rawContent)
    const validation = this.validateEntryContent(content)
    if (!validation.ok) {
      return this.fail(current, action, validation.reason, validation.code)
    }

    const nextEntries = [...current.entries]
    nextEntries[match.index] = content
    const dedupedEntries = dedupeEntries(nextEntries)
    const overflow = this.checkLimit(current.target, dedupedEntries)
    if (overflow) {
      return this.fail(current, action, overflow.error, 'limit_exceeded', overflow.projectedUsage)
    }

    if (dedupedEntries.join('\u0000') === dedupeEntries(current.entries).join('\u0000')) {
      return {
        success: true,
        changed: false,
        action,
        target: current.target,
        entries: current.entries,
        usage: current.usage,
        message: 'Entry already matches the requested replacement.'
      }
    }

    return this.persistSuccess(current.target, action, dedupedEntries, 'Replaced memory entry.')
  }

  private async removeEntry(
    current: PersistentMemoryStoreState,
    action: PersistentMemoryAction,
    oldText: string
  ): Promise<PersistentMemoryOperationResult> {
    const match = this.findUniqueMatch(current.entries, oldText)
    if (!match.ok) {
      return this.fail(current, action, match.error, match.code)
    }

    const nextEntries = current.entries.filter((_, index) => index !== match.index)
    return this.persistSuccess(current.target, action, nextEntries, 'Removed memory entry.')
  }

  private validateEntryContent(content: string): EntryValidationResult {
    if (!content) {
      return {
        ok: false,
        reason: 'Memory entry content cannot be empty.',
        code: 'security_blocked'
      }
    }

    const scanResult = scanMemoryEntry(content)
    if (!scanResult.ok) {
      return {
        ok: false,
        reason: scanResult.reason,
        code: 'security_blocked'
      }
    }

    return { ok: true }
  }

  private findUniqueMatch(entries: string[], rawNeedle: string): MatchResult {
    const needle = normalizeEntry(rawNeedle)
    if (!needle) {
      return {
        ok: false,
        error: 'old_text must be a non-empty unique substring.',
        code: 'not_found'
      }
    }

    const matches = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.includes(needle))

    if (matches.length === 0) {
      return {
        ok: false,
        error: `No memory entry matched substring "${needle}".`,
        code: 'not_found'
      }
    }

    if (matches.length > 1) {
      return {
        ok: false,
        error: `Substring "${needle}" matched multiple entries. Provide a more specific old_text.`,
        code: 'ambiguous_match'
      }
    }

    return {
      ok: true,
      index: matches[0].index
    }
  }

  private checkLimit(
    target: PersistentMemoryTarget,
    entries: string[]
  ): {
    error: string
    projectedUsage: PersistentMemoryUsage
  } | null {
    const config = this.getConfig(target)
    const rendered = renderMemoryEntries(entries)
    const projectedUsage = createUsage(rendered.length, config.charLimit)
    if (projectedUsage.usedChars <= projectedUsage.limit) {
      return null
    }

    return {
      error:
        `Memory at ${projectedUsage.usedChars}/${projectedUsage.limit} chars would exceed ` +
        'the limit. Replace or remove existing entries first.',
      projectedUsage
    }
  }

  private async persistSuccess(
    target: PersistentMemoryTarget,
    action: PersistentMemoryAction,
    entries: string[],
    message: string
  ): Promise<PersistentMemoryOperationResult> {
    await this.writeStore(target, entries)
    const next = await this.readStore(target)

    return {
      success: true,
      changed: true,
      action,
      target,
      entries: next.entries,
      usage: next.usage,
      message
    }
  }

  private fail(
    current: PersistentMemoryStoreState,
    action: PersistentMemoryAction,
    error: string,
    code?: PersistentMemoryOperationResult['code'],
    projectedUsage?: PersistentMemoryUsage
  ): PersistentMemoryOperationResult {
    return {
      success: false,
      changed: false,
      action,
      target: current.target,
      entries: current.entries,
      usage: current.usage,
      error,
      code,
      projectedUsage
    }
  }

  private renderPromptSection(store: PersistentMemoryStoreState): string {
    const config = this.getConfig(store.target)
    const header =
      `${config.promptTitle} (${config.promptDescription}) ` +
      `[${store.usage.percent}% - ${store.usage.usedChars}/${store.usage.limit} chars]`

    return `${header}\n${store.entries.join(`\n${MEMORY_ENTRY_DELIMITER}\n`)}`
  }

  private async writeStore(target: PersistentMemoryTarget, entries: string[]): Promise<void> {
    const config = this.getConfig(target)
    const filePath = path.join(this.memoriesDir, config.fileName)
    const tempPath = path.join(this.memoriesDir, `${config.fileName}.${randomUUID()}.tmp`)
    const rendered = renderMemoryEntries(entries)

    await fs.mkdir(this.memoriesDir, { recursive: true })
    await fs.writeFile(tempPath, rendered, 'utf8')
    await fs.rename(tempPath, filePath)
  }

  private async readStoreFile(filePath: string): Promise<string> {
    try {
      return await fs.readFile(filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return ''
      }

      throw error
    }
  }

  private getConfig(target: PersistentMemoryTarget): PersistentMemoryStoreConfig {
    return this.storeConfigs[target]
  }
}

let sharedRepository: PersistentMemoryRepository | null = null

export const getPersistentMemoryRepository = (): PersistentMemoryRepository => {
  if (!sharedRepository) {
    sharedRepository = new PersistentMemoryRepository()
  }

  return sharedRepository
}
