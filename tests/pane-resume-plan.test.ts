// B17 · The pure rules of a pane's resume plan and of the Claude session id main names. No provider runs.
import { describe, expect, it, vi } from 'vitest'
import { claudeSessionToAssign, permissionModeArgs, planPaneResume } from '../electron/main/services/agent-state/pane-resume'
import { isMessageCode } from '../shared/messages'

const A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const deps = (allowed = true, exists = true) => ({ allowed: vi.fn(() => allowed), exists: vi.fn(async () => exists) })

describe('planPaneResume', () => {
  it('says nothing on a start that is not the pane\'s first in this run', async () => {
    expect(await planPaneResume(null, { agentCommand: 'claude' }, '/repo', deps())).toEqual({ agentCommand: 'claude', extraArgs: [] })
  })

  it('refuses a provider the policy blocks, before looking at the disk', async () => {
    const d = deps(false)
    expect(await planPaneResume({ agent: 'claude', sessionId: A, wanted: true }, { agentCommand: 'claude' }, '/repo', d))
      .toEqual({ agentCommand: 'claude', extraArgs: [], status: { outcome: 'notResumed', agent: 'claude', sessionId: A, message: { code: 'agents.resume.blocked', params: {} } } })
    expect(d.exists).not.toHaveBeenCalled()
  })

  it('leaves a command that picks its own session alone', async () => {
    for (const command of ['claude --continue', 'claude -r', 'claude --resume=x', 'claude -p hi']) {
      expect((await planPaneResume({ agent: 'claude', sessionId: A, wanted: true }, { agentCommand: command }, '/repo', deps())).status, command).toMatchObject({ message: { code: 'agents.resume.launchOverride' } })
    }
    expect((await planPaneResume({ agent: 'codex', sessionId: A, wanted: true }, { agentCommand: 'codex exec run' }, '/repo', deps())).status).toMatchObject({ message: { code: 'agents.resume.launchOverride' } })
    // A shell pane with a prompt to type keeps its shell.
    expect((await planPaneResume({ agent: 'codex', sessionId: A, wanted: true }, { initialPrompt: 'ls' }, '/repo', deps())).status).toMatchObject({ message: { code: 'agents.resume.launchOverride' } })
  })

  it('checks the session in the folder the pane starts in, and builds the arguments itself', async () => {
    const d = deps()
    expect(await planPaneResume({ agent: 'codex', sessionId: A, wanted: true }, { agentCommand: 'C:\\bin\\codex.cmd -c model=o3' }, 'C:\\repo', d))
      .toEqual({ agentCommand: 'C:\\bin\\codex.cmd -c model=o3', extraArgs: ['resume', A, '--no-alt-screen'], status: { outcome: 'resumed', agent: 'codex', sessionId: A } })
    expect(d.exists).toHaveBeenCalledWith('codex', A, 'C:\\repo')
  })

  it('every reason is a message code', () => {
    for (const code of ['sessionMissing', 'otherAgent', 'launchOverride', 'blocked', 'disabled']) expect(isMessageCode(`agents.resume.${code}`), code).toBe(true)
  })
})

describe('claudeSessionToAssign', () => {
  it('names a fresh Claude conversation only', () => {
    expect(claudeSessionToAssign('claude', [])).toMatch(/^[0-9a-f-]{36}$/)
    expect(claudeSessionToAssign('C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd', ['--model', 'opus'])).toMatch(/^[0-9a-f-]{36}$/)
    expect(claudeSessionToAssign('codex', [])).toBeNull()
    expect(claudeSessionToAssign('pwsh', ['-NoLogo'])).toBeNull()
    expect(claudeSessionToAssign(undefined, [])).toBeNull()
    for (const args of [['--continue'], ['-c'], ['--resume', A], ['--session-id', A], ['-p', 'hi'], ['--print'], ['mcp', 'list'], ['doctor'], ['--fork-session']]) {
      expect(claudeSessionToAssign('claude', args), args.join(' ')).toBeNull()
    }
  })

  it('gives each start its own id', () => {
    expect(claudeSessionToAssign('claude', [])).not.toBe(claudeSessionToAssign('claude', []))
  })
})

describe('T54 · permissionModeArgs', () => {
  it('maps each recorded mode to Claude flags from a closed list, never more than recorded', () => {
    // bypassPermissions only with the person's setting: the recorded mode comes from a hook any process can send.
    expect(permissionModeArgs('bypassPermissions', [])).toEqual([])
    expect(permissionModeArgs('bypassPermissions', [], true)).toEqual(['--dangerously-skip-permissions'])
    expect(permissionModeArgs('acceptEdits', [])).toEqual(['--permission-mode', 'acceptEdits'])
    expect(permissionModeArgs('plan', [])).toEqual(['--permission-mode', 'plan'])
    expect(permissionModeArgs('default', [])).toEqual([])
    expect(permissionModeArgs(undefined, [])).toEqual([])
  })

  it('adds nothing when the command already sets a mode', () => {
    for (const command of [['--dangerously-skip-permissions'], ['--permission-mode', 'plan'], ['--permission-mode=plan'], ['--allow-dangerously-skip-permissions']]) {
      expect(permissionModeArgs('bypassPermissions', command, true), command.join(' ')).toEqual([])
    }
  })

  it('a B17 resume of a Claude session puts the mode before --resume; Codex never gets one', async () => {
    expect((await planPaneResume({ agent: 'claude', sessionId: A, wanted: true, permissionMode: 'plan' }, {}, '/repo', deps())).extraArgs)
      .toEqual(['--permission-mode', 'plan', '--resume', A])
    expect(await planPaneResume({ agent: 'claude', sessionId: A, wanted: true, permissionMode: 'bypassPermissions' }, {}, '/repo', deps()))
      .toMatchObject({ extraArgs: ['--resume', A], status: { outcome: 'resumed', note: { code: 'agents.resume.bypassWithheld' } } })
    expect((await planPaneResume({ agent: 'claude', sessionId: A, wanted: true, permissionMode: 'bypassPermissions' }, {}, '/repo', { ...deps(), allowBypass: true })).extraArgs)
      .toEqual(['--dangerously-skip-permissions', '--resume', A])
    expect((await planPaneResume({ agent: 'codex', sessionId: A, wanted: true, permissionMode: 'bypassPermissions' }, {}, '/repo', { ...deps(), allowBypass: true })).extraArgs)
      .toEqual(['resume', A, '--no-alt-screen'])
  })
})
