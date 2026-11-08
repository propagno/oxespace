// Frozen acceptance test for 1.5.0 A31 / T84 (OXE program, phase F8): the command bar parses what the person types and
// every command maps to an existing IPC action, with a fallback button. There is no /approve: /deny only declines.
// Skills run through skill:invoke. Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f8-agora-history.md §A31; DESIGN 1.5.0-f8-design.md U8.3.
import { describe, expect, test } from 'vitest'
import { COMMAND_CATALOG, parseCommandLine } from '../../../shared/command-bar'
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
    for (const id of ['pending', 'deny', 'steer', 'stop', 'new', 'history', 'agora', 'terminal', 'theme']) expect(parseCommandLine(`/${id}`), id).toMatchObject({ kind: 'command', id })
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
    expect(COMMAND_CATALOG.length).toBeGreaterThanOrEqual(9)
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

  test('A31: Stop asks first; the bar has no new power: /history only opens the timeline, and nothing in it branches', () => {
    expect(COMMAND_CATALOG.find(entry => entry.id === 'stop')).toMatchObject({ confirm: true })
    // /history opens time travel (read), and nothing in the bar branches: Branch stays a person's dialog.
    expect(COMMAND_CATALOG.find(entry => entry.id === 'history')?.ipc).toBe('thread.timeline')
    expect(COMMAND_CATALOG.some(entry => entry.ipc === 'thread.branchFromCheckpoint')).toBe(false)
  })
})
