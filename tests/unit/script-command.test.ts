import { describe, expect, test } from 'vitest'
import {
  buildScriptCommand,
  escapeDoubleQuotes,
  joinWorkspacePath
} from '../../shared/utils/script-command'

// This module is the single source the Scripts panel (renderer) and the
// internal MCP `oxespace_list_scripts` tool (main) both build commands from, so
// both platforms are asserted explicitly rather than following the host.
describe('buildScriptCommand', () => {
  describe('win32', () => {
    test('runs .ps1 through PowerShell with profile and policy pinned', () => {
      expect(buildScriptCommand('C:\\repo\\build.ps1', 'ps1', 'win32')).toBe(
        'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\repo\\build.ps1"'
      )
    })

    test('runs .sh through the bash Git for Windows ships', () => {
      const command = buildScriptCommand('C:\\repo\\deploy.sh', 'sh', 'win32')
      expect(command).toContain('%ProgramFiles%\\Git\\bin\\bash.exe')
      expect(command).toContain('%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe')
      expect(command).toContain('C:\\repo\\deploy.sh')
      expect(command).toContain('exit /b 1')
    })
  })

  describe('posix', () => {
    test('runs .sh through bash', () => {
      expect(buildScriptCommand('/home/dev/repo/deploy.sh', 'sh', 'linux')).toBe(
        'bash "/home/dev/repo/deploy.sh"'
      )
    })

    test('runs .ps1 through pwsh, not powershell.exe', () => {
      expect(buildScriptCommand('/home/dev/repo/build.ps1', 'ps1', 'linux')).toBe(
        'pwsh -NoProfile -File "/home/dev/repo/build.ps1"'
      )
    })

    test('never emits cmd.exe syntax', () => {
      for (const ext of ['sh', 'ps1'] as const) {
        const command = buildScriptCommand('/home/dev/repo/x', ext, 'linux')
        expect(command).not.toContain('if exist')
        expect(command).not.toContain('%ProgramFiles%')
        expect(command).not.toContain('.exe')
      }
    })

    test('treats darwin like linux', () => {
      expect(buildScriptCommand('/repo/a.sh', 'sh', 'darwin')).toBe('bash "/repo/a.sh"')
    })
  })

  test('quotes are escaped so a crafted filename cannot break out of the argument', () => {
    expect(buildScriptCommand('/repo/we"ird.sh', 'sh', 'linux')).toBe('bash "/repo/we\\"ird.sh"')
    expect(escapeDoubleQuotes('a"b"c')).toBe('a\\"b\\"c')
  })
})

describe('joinWorkspacePath', () => {
  test('keeps the separator style of the workspace root', () => {
    expect(joinWorkspacePath('C:\\repo', 'scripts/build.ps1')).toBe('C:\\repo\\scripts\\build.ps1')
    expect(joinWorkspacePath('/home/dev/repo', 'scripts/build.sh')).toBe('/home/dev/repo/scripts/build.sh')
  })

  test('collapses a trailing separator on the root', () => {
    expect(joinWorkspacePath('/home/dev/repo/', 'a.sh')).toBe('/home/dev/repo/a.sh')
    expect(joinWorkspacePath('C:\\repo\\', 'a.ps1')).toBe('C:\\repo\\a.ps1')
  })
})
