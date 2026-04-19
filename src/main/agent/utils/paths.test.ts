import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  resolveDatabasePath,
  resolveDeepClawHomeDir,
  resolveDeepClawPath,
  resolveDefaultWorkingDir,
  resolveEnvFilePath,
  resolveMemoriesDir,
  resolveSkillsDir,
  resolveTmpDir
} from './paths'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DeepClaw path utils', () => {
  it('resolves canonical DeepClaw paths from the user home directory', () => {
    vi.spyOn(os, 'homedir').mockReturnValue(path.join('C:', 'Users', 'tester'))

    expect(resolveDeepClawHomeDir()).toBe(path.join('C:', 'Users', 'tester', '.deepclaw'))
    expect(resolveDeepClawPath('nested', 'value')).toBe(
      path.join('C:', 'Users', 'tester', '.deepclaw', 'nested', 'value')
    )
    expect(resolveDefaultWorkingDir()).toBe(path.join('C:', 'Users', 'tester', '.deepclaw'))
    expect(resolveTmpDir()).toBe(path.join('C:', 'Users', 'tester', '.deepclaw', 'tmp'))
    expect(resolveMemoriesDir()).toBe(path.join('C:', 'Users', 'tester', '.deepclaw', 'memories'))
    expect(resolveSkillsDir()).toBe(path.join('C:', 'Users', 'tester', '.deepclaw', 'skills'))
    expect(resolveEnvFilePath()).toBe(path.join('C:', 'Users', 'tester', '.deepclaw', '.env'))
    expect(resolveDatabasePath()).toBe(
      path.join('C:', 'Users', 'tester', '.deepclaw', 'deepclaw.db')
    )
  })
})
