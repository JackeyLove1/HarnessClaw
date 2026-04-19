import { mkdtempSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  archiveLogFile,
  formatArchiveTimestamp,
  LOG_MAX_FILES,
  LOG_MAX_SIZE_BYTES,
  resolveManagedLogPath,
  resolveProcessLogFileName
} from './logging'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('main logging helpers', () => {
  it('resolves date-based log file names under ~/.deepclaw/logs', () => {
    const logsDir = path.join('C:', 'Users', 'tester', '.deepclaw', 'logs')
    const fixedDate = new Date('2026-04-19T12:00:00.000Z')

    expect(resolveProcessLogFileName(fixedDate)).toBe('deepclaw-2026-04-19.log')
    expect(resolveManagedLogPath(undefined, logsDir)).toMatch(/^deepclaw-\d{4}-\d{2}-\d{2}\.log$/)
    expect(resolveManagedLogPath(undefined, logsDir)).toContain(logsDir)
    expect(LOG_MAX_SIZE_BYTES).toBe(5 * 1024 * 1024)
  })

  it('rotates to timestamped archive files and enforces the max file count', () => {
    const logsDir = mkdtempSync(path.join(os.tmpdir(), 'notemark-logs-'))
    const activeLog = path.join(logsDir, 'deepclaw-2026-04-19.log')

    writeFileSync(activeLog, 'active')
    writeFileSync(path.join(logsDir, 'deepclaw-2026-04-18.log'), 'older active')

    for (let index = 0; index < LOG_MAX_FILES - 1; index += 1) {
      const archiveName = `deepclaw-2026-04-19-20240101T00000${index}.${index.toString().padStart(3, '0')}Z.log`
      writeFileSync(path.join(logsDir, archiveName), `archive-${index}`)
    }

    const archivedPath = archiveLogFile(activeLog, {
      logsDir,
      now: new Date('2026-04-19T12:34:56.789Z')
    })

    expect(path.basename(archivedPath)).toBe(`deepclaw-2026-04-19-${formatArchiveTimestamp(new Date('2026-04-19T12:34:56.789Z'))}.log`)

    const files = readdirSync(logsDir).sort()
    expect(files).toHaveLength(LOG_MAX_FILES)
    expect(files).toContain('deepclaw-2026-04-18.log')
    expect(files).toContain(path.basename(archivedPath))
    expect(files).not.toContain('deepclaw-2026-04-19-20240101T000000.000Z.log')
  })

  it('adds a numeric suffix when an archive name collision occurs', () => {
    const logsDir = mkdtempSync(path.join(os.tmpdir(), 'notemark-logs-collision-'))
    const activeLog = path.join(logsDir, 'deepclaw-2026-04-19.log')
    const archiveTimestamp = formatArchiveTimestamp(new Date('2026-04-19T12:34:56.789Z'))

    mkdirSync(logsDir, { recursive: true })
    writeFileSync(activeLog, 'active')
    writeFileSync(path.join(logsDir, `deepclaw-2026-04-19-${archiveTimestamp}.log`), 'existing archive')

    const archivedPath = archiveLogFile(activeLog, {
      logsDir,
      now: new Date('2026-04-19T12:34:56.789Z')
    })

    expect(path.basename(archivedPath)).toBe(`deepclaw-2026-04-19-${archiveTimestamp}-1.log`)
  })
})
