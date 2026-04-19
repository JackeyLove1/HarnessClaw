import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PersistentMemoryRepository } from '../../memory'
import { createMemoryTool } from './index'

const cleanupDirs = new Set<string>()

const createRepository = async (): Promise<PersistentMemoryRepository> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notemark-memory-tool-'))
  cleanupDirs.add(dir)
  return new PersistentMemoryRepository({ memoriesDir: dir })
}

afterEach(async () => {
  await Promise.all(
    [...cleanupDirs].map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
      cleanupDirs.delete(dir)
    })
  )
})

describe('createMemoryTool', () => {
  it('validates required fields by action', async () => {
    const tool = createMemoryTool({ repository: await createRepository() })

    await expect(
      tool.execute('tool_memory_invalid', {
        action: 'replace',
        target: 'memory'
      })
    ).rejects.toThrow('content is required')

    await expect(
      tool.execute('tool_memory_invalid_remove', {
        action: 'remove',
        target: 'memory'
      })
    ).rejects.toThrow('old_text is required')
  })

  it('returns structured semantic failures in the tool payload', async () => {
    const tool = createMemoryTool({ repository: await createRepository() })

    const result = await tool.execute('tool_memory_fail', {
      action: 'remove',
      target: 'memory',
      old_text: 'missing'
    })

    const payload = JSON.parse(result.content[0]?.text ?? '{}') as {
      success?: boolean
      code?: string
    }
    expect(payload).toMatchObject({
      success: false,
      code: 'not_found'
    })
    expect(result.details.summary).toContain('failed')
  })

  it('returns live state after a successful mutation', async () => {
    const tool = createMemoryTool({ repository: await createRepository() })

    const result = await tool.execute('tool_memory_add', {
      action: 'add',
      target: 'user',
      content: 'User prefers concise responses.'
    })

    const payload = JSON.parse(result.content[0]?.text ?? '{}') as {
      success?: boolean
      changed?: boolean
      entries?: string[]
      usage?: { usedChars?: number }
    }

    expect(payload).toMatchObject({
      success: true,
      changed: true,
      entries: ['User prefers concise responses.']
    })
    expect(payload.usage?.usedChars).toBeGreaterThan(0)
    expect(result.details.summary).toContain('memory add')
  })
})
