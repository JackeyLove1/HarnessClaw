import { createShellTool, type ShellToolOptions } from '../ShellTool'
import { evaluatePowerShellPermission } from './permission'
import { POWERSHELL_TOOL_PROMPT } from './prompt'

export type PowerShellToolOptions = Omit<ShellToolOptions, 'description' | 'label' | 'name' | 'shellExecutable' | 'shellArgs' | 'permission'>

export function createPowerShellTool(options: PowerShellToolOptions = {}) {
  return createShellTool({
    ...options,
    name: 'powershell',
    label: 'PowerShell',
    description: POWERSHELL_TOOL_PROMPT,
    shellExecutable: 'powershell',
    shellArgs: (command) => ['-NoProfile', '-NonInteractive', '-Command', command],
    permission: evaluatePowerShellPermission
  })
}
