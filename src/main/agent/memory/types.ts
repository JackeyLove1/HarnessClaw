export const PERSISTENT_MEMORY_TARGETS = ['memory', 'user'] as const

export type PersistentMemoryTarget = (typeof PERSISTENT_MEMORY_TARGETS)[number]

export const PERSISTENT_MEMORY_ACTIONS = ['add', 'replace', 'remove'] as const

export type PersistentMemoryAction = (typeof PERSISTENT_MEMORY_ACTIONS)[number]

export type PersistentMemoryErrorCode =
  | 'duplicate'
  | 'ambiguous_match'
  | 'not_found'
  | 'limit_exceeded'
  | 'security_blocked'

export type PersistentMemoryStoreConfig = {
  target: PersistentMemoryTarget
  fileName: string
  promptTitle: string
  promptDescription: string
  charLimit: number
}

export type PersistentMemoryUsage = {
  usedChars: number
  limit: number
  remainingChars: number
  percent: number
  text: string
}

export type PersistentMemoryStoreState = {
  target: PersistentMemoryTarget
  filePath: string
  entries: string[]
  usage: PersistentMemoryUsage
}

export type PersistentMemoryPromptSnapshot = {
  rendered: string | null
  stores: PersistentMemoryStoreState[]
}

export type PersistentMemoryOperationRequest = {
  action: PersistentMemoryAction
  target: PersistentMemoryTarget
  content?: string
  oldText?: string
}

export type PersistentMemoryOperationResult = {
  success: boolean
  changed: boolean
  action: PersistentMemoryAction
  target: PersistentMemoryTarget
  entries: string[]
  usage: PersistentMemoryUsage
  message?: string
  error?: string
  code?: PersistentMemoryErrorCode
  projectedUsage?: PersistentMemoryUsage
}
