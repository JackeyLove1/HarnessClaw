import { describe, expect, it } from 'vitest'

import { createBashTool } from '../BashTool'
import { createGetTimeTool } from '../get-time'
import { createPowerShellTool } from '../PowerShellTool'
import { createPlatformShellTool, createReadOnlyTools, createTools } from '..'

const parseText = (
  toolResult: Awaited<ReturnType<ReturnType<typeof createBashTool>['execute']>>
) => {
  return JSON.parse(toolResult.content[0].text) as Record<string, unknown>
}

describe('shell tools', () => {
  it('blocks dangerous bash commands with built-in deny regex', async () => {
    const tool = createBashTool()
    const result = await tool.execute('tool_1', { command: 'rm -rf *' })
    const payload = parseText(result)

    expect(payload.blocked).toBe(true)
    expect(payload.reason).toBeTypeOf('string')
    expect(result.details.summary).toContain('blocked')
  })

  it('applies deny-first when allow and deny rules both match', async () => {
    const tool = createBashTool({
      allowRules: [{ name: 'allow-rm', reason: 'test allow', pattern: /\brm\b/i }],
      denyRules: [{ name: 'deny-rm', reason: 'test deny', pattern: /\brm\b/i }]
    })
    const result = await tool.execute('tool_2', { command: 'rm temp.txt' })
    const payload = parseText(result)

    expect(payload.blocked).toBe(true)
    expect(payload.matched_rule).toBe('deny-rm')
  })

  it('runs pre hooks before execution and can block the command', async () => {
    let ranCommand = false
    const tool = createBashTool({
      preToolUseHooks: [
        () => ({
          block: true,
          reason: 'blocked by pre hook'
        })
      ],
      runCommand: async () => {
        ranCommand = true
        return {
          stdout: '',
          stderr: '',
          exitCode: 0,
          signal: null,
          timedOut: false,
          failedToStart: false
        }
      }
    })

    const result = await tool.execute('tool_3', { command: 'echo hello' })
    const payload = parseText(result)

    expect(ranCommand).toBe(false)
    expect(payload.blocked).toBe(true)
    expect(payload.reason).toBe('blocked by pre hook')
  })

  it('runs post hooks after execution and can augment summary/details', async () => {
    const tool = createBashTool({
      runCommand: async () => ({
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
        signal: null,
        timedOut: false,
        failedToStart: false
      }),
      postToolUseHooks: [
        () => ({
          summary: 'custom summary',
          details: { audited: true }
        })
      ]
    })

    const result = await tool.execute('tool_4', { command: 'echo ok' })

    expect(result.details.summary).toBe('custom summary')
    expect(result.details.audited).toBe(true)
  })

  it('loads the platform shell tool only in createTools', () => {
    expect(createPlatformShellTool('win32').name).toBe('powershell')
    expect(createPlatformShellTool('linux').name).toBe('bash')
    expect(createPlatformShellTool('darwin').name).toBe('bash')

    const readOnly = createReadOnlyTools().map((tool) => tool.name)
    expect(readOnly).not.toContain('bash')
    expect(readOnly).not.toContain('powershell')

    expect(createTools({ platform: 'win32' }).some((tool) => tool.name === 'powershell')).toBe(true)
    expect(createTools({ platform: 'linux' }).some((tool) => tool.name === 'bash')).toBe(true)
  })

  it('blocks dangerous powershell commands with built-in deny regex', async () => {
    const tool = createPowerShellTool()
    const result = await tool.execute('tool_5', {
      command: 'Remove-Item -Recurse -Force C:\\Temp'
    })
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>

    expect(payload.blocked).toBe(true)
    expect(payload.reason).toBeTypeOf('string')
  })

  it('validates shell tool input with zod v4 before execution', async () => {
    const tool = createBashTool()

    await expect(
      tool.execute('tool_6', {
        command: '   ',
        timeout_ms: 10
      })
    ).rejects.toThrow(/Invalid input for tool "bash"/)
  })

  it('validates no-arg tools with strict object schemas', async () => {
    const tool = createGetTimeTool()

    await expect(
      tool.execute('tool_7', {
        unexpected: true
      })
    ).rejects.toThrow(/Invalid input for tool "get_time"/)
  })
})
