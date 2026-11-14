import { describe, expect, it } from 'vitest'
import { agentProgram, withFullAccess } from '../../electron/main/services/agent-state/agent-full-access'

describe('the option that starts an agent without permission prompts', () => {
  it('names the agent by its program, whatever the folder, the case or the Windows extension', () => {
    expect(agentProgram('claude')).toBe('claude')
    expect(agentProgram('C:\\Users\\me\\AppData\\Roaming\\npm\\Claude.CMD')).toBe('claude')
    expect(agentProgram('/usr/local/bin/codex')).toBe('codex')
    expect(agentProgram(' agy.exe ')).toBe('agy')
    expect(agentProgram('powershell.exe')).toBe('powershell')
    expect(agentProgram('')).toBeUndefined()
    expect(agentProgram(undefined)).toBeUndefined()
  })

  it('goes first, so nothing after a "--" or a prompt can turn it into text', () => {
    expect(withFullAccess('claude', ['--resume', 'abc', '--', 'fix the build'], true)).toEqual(['--dangerously-skip-permissions', '--resume', 'abc', '--', 'fix the build'])
    expect(withFullAccess('codex', ['resume', 'abc'], true)).toEqual(['--dangerously-bypass-approvals-and-sandbox', 'resume', 'abc'])
    expect(withFullAccess('agy', [], true)).toEqual(['--dangerously-skip-permissions'])
  })

  it('adds nothing with the setting off, for a program it does not know, or for a shell', () => {
    expect(withFullAccess('claude', ['--resume', 'abc'], false)).toEqual(['--resume', 'abc'])
    expect(withFullAccess('cursor-agent', [], true)).toEqual([])
    expect(withFullAccess('powershell', ['-NoLogo'], true)).toEqual(['-NoLogo'])
    expect(withFullAccess(undefined, ['-l'], true)).toEqual(['-l'])
    // A name that is also a property of every object is not an agent.
    expect(withFullAccess('constructor', [], true)).toEqual([])
    expect(withFullAccess('toString', ['x'], true)).toEqual(['x'])
  })

  it('leaves a command that already chooses its mode or its sandbox as it is', () => {
    for (const own of ['--permission-mode', '--permission-mode=plan', '--dangerously-skip-permissions', '--allow-dangerously-skip-permissions']) {
      expect(withFullAccess('claude', [own, 'plan'], true), own).toEqual([own, 'plan'])
    }
    for (const own of ['--sandbox', '--sandbox=read-only', '-s', '--full-auto', '--ask-for-approval', '-a', '--dangerously-bypass-approvals-and-sandbox']) {
      expect(withFullAccess('codex', [own, 'x'], true), own).toEqual([own, 'x'])
    }
    expect(withFullAccess('agy', ['--sandbox'], true)).toEqual(['--sandbox'])
    // A word that only looks like one of them is not a choice.
    expect(withFullAccess('codex', ['--sandboxed-notes'], true)).toEqual(['--dangerously-bypass-approvals-and-sandbox', '--sandboxed-notes'])
  })

  it('returns its own list: the caller\'s arguments are never changed', () => {
    const given = ['--resume', 'abc']
    const got = withFullAccess('claude', given, false)
    expect(got).not.toBe(given)
    expect(given).toEqual(['--resume', 'abc'])
  })
})
