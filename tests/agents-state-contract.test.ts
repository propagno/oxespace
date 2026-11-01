import { describe, expect, it } from 'vitest'
import enCommon from '../shared/locales/en/common.json'
import ptCommon from '../shared/locales/pt-BR/common.json'
import enMobile from '../shared/locales/en/mobile.json'
import ptMobile from '../shared/locales/pt-BR/mobile.json'
import {
  AGENT_BADGE_STATES, AGENT_KINDS, AGENT_STATE_LABEL_KEYS, AGENT_STATES, AGENT_TERMINAL_LABEL_KEYS, agentKey, agentMode, agentOwnership, agentState, applyAgentOwnership, compareAgentRows,
  isSeenSince, paneToneState, parseAgentKey, type AgentKey, type AgentPaneTone, type AgentState, type AgentStateInput, type AgentStateResult
} from '../shared/agents/agentState'
import { REMOTE_AGENT_KINDS, REMOTE_AGENT_STATES, REMOTE_APPROVAL_RISKS } from '../shared/remote/protocol'
import { APPROVAL_RISKS } from '../shared/types/approvals'
import type { PaneDisplayTone } from '../src/utils/paneDisplay'

const lookup = (catalog: unknown, key: string): unknown => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog)
const is = (value: AgentState): AgentStateResult => ({ ended: false, state: value })
const ENDED: AgentStateResult = { ended: true }

/** §3.2, one line per source state and the conditions that decide between columns. */
const TABLE: [string, AgentStateInput, AgentStateResult][] = [
  // Pane: lifecycle (main) and terminal status. The lifecycle counts only while the terminal runs.
  ['pane blocked', { kind: 'pane', lifecycle: 'blocked', terminal: 'running', seen: false }, is('needs-you')],
  ['pane terminal error', { kind: 'pane', lifecycle: 'working', terminal: 'error', seen: false }, is('failed')],
  ['pane terminal error, even when the lifecycle said blocked', { kind: 'pane', lifecycle: 'blocked', terminal: 'error', seen: false }, is('failed')],
  ['pane working', { kind: 'pane', lifecycle: 'working', terminal: 'running', seen: false }, is('working')],
  ['pane terminal starting', { kind: 'pane', lifecycle: null, terminal: 'starting', seen: false }, is('working')],
  ['pane done, unseen', { kind: 'pane', lifecycle: 'done', terminal: 'running', seen: false }, is('finished')],
  ['pane done, seen', { kind: 'pane', lifecycle: 'done', terminal: 'running', seen: true }, is('idle')],
  ['pane idle', { kind: 'pane', lifecycle: 'idle', terminal: 'running', seen: false }, is('idle')],
  ['pane stopped by the person', { kind: 'pane', lifecycle: 'working', terminal: 'exited', stoppedByPerson: true, seen: false }, is('stopped')],
  ['pane exited on its own ends the row', { kind: 'pane', lifecycle: 'idle', terminal: 'exited', seen: false }, ENDED],
  ['pane lifecycle unknown', { kind: 'pane', lifecycle: 'unknown', terminal: 'running', seen: false }, is('unknown')],
  ['pane with no lifecycle report (an estimate on the desktop)', { kind: 'pane', lifecycle: null, terminal: 'running', seen: false }, is('unknown')],
  ['pane terminal not started', { kind: 'pane', lifecycle: null, terminal: 'idle', seen: false }, is('unknown')],

  // Conversation: ThreadStatus, lastTurnStatus, pendingRequests, backgroundRunning, providerObservation.state.
  ['conversation approval', { kind: 'conversation', status: 'approval', pendingRequests: 1, backgroundRunning: 0, seen: false }, is('needs-you')],
  ['conversation with a pending request', { kind: 'conversation', status: 'running', pendingRequests: 2, backgroundRunning: 0, seen: false }, is('needs-you')],
  ['conversation awaiting input (Codex observation)', { kind: 'conversation', status: 'idle', pendingRequests: 0, backgroundRunning: 0, observation: 'awaiting-input', seen: true }, is('needs-you')],
  ['conversation failed', { kind: 'conversation', status: 'failed', lastTurnStatus: 'failed', pendingRequests: 0, backgroundRunning: 0, seen: true }, is('failed')],
  ['conversation failed with a request: needs-you wins', { kind: 'conversation', status: 'failed', pendingRequests: 1, backgroundRunning: 0, seen: false }, is('needs-you')],
  ['conversation running', { kind: 'conversation', status: 'running', pendingRequests: 0, backgroundRunning: 0, seen: false }, is('working')],
  ['conversation idle with background tasks', { kind: 'conversation', status: 'idle', lastTurnStatus: 'completed', pendingRequests: 0, backgroundRunning: 2, seen: false }, is('working')],
  ['conversation interrupted with background tasks: working wins', { kind: 'conversation', status: 'interrupted', pendingRequests: 0, backgroundRunning: 1, seen: false }, is('working')],
  ['conversation completed, unseen', { kind: 'conversation', status: 'idle', lastTurnStatus: 'completed', pendingRequests: 0, backgroundRunning: 0, seen: false }, is('finished')],
  ['conversation completed, seen', { kind: 'conversation', status: 'idle', lastTurnStatus: 'completed', pendingRequests: 0, backgroundRunning: 0, seen: true }, is('idle')],
  ['conversation new, never ran', { kind: 'conversation', status: 'idle', pendingRequests: 0, backgroundRunning: 0, seen: false }, is('idle')],
  ['conversation idle after an interrupted turn', { kind: 'conversation', status: 'idle', lastTurnStatus: 'interrupted', pendingRequests: 0, backgroundRunning: 0, seen: false }, is('idle')],
  ['conversation interrupted', { kind: 'conversation', status: 'interrupted', lastTurnStatus: 'interrupted', pendingRequests: 0, backgroundRunning: 0, seen: false }, is('stopped')],

  // Delegation: DelegationState and who waits on it.
  ['delegation blocked on the person', { kind: 'delegation', state: 'blocked', requester: 'person', seen: false }, is('needs-you')],
  ['delegation in review for the person', { kind: 'delegation', state: 'review', requester: 'person', seen: false }, is('needs-you')],
  ['delegation blocked on its lead', { kind: 'delegation', state: 'blocked', requester: 'agent', seen: false }, { ended: false, state: 'working', waitingForLead: true }],
  ['delegation in review by its lead', { kind: 'delegation', state: 'review', requester: 'agent', seen: false }, { ended: false, state: 'working', waitingForLead: true }],
  ['delegation failed', { kind: 'delegation', state: 'failed', requester: 'person', seen: false }, is('failed')],
  ['delegation preparing', { kind: 'delegation', state: 'preparing', requester: 'agent', seen: false }, is('working')],
  ['delegation starting', { kind: 'delegation', state: 'starting', requester: 'agent', seen: false }, is('working')],
  ['delegation accepted', { kind: 'delegation', state: 'accepted', requester: 'agent', seen: false }, is('working')],
  ['delegation approved, unseen', { kind: 'delegation', state: 'approved', requester: 'person', seen: false }, is('finished')],
  ['delegation approved, seen', { kind: 'delegation', state: 'approved', requester: 'person', seen: true }, is('idle')],
  ['delegation cancelled', { kind: 'delegation', state: 'cancelled', requester: 'person', seen: false }, is('stopped')],
  ['delegation interrupted', { kind: 'delegation', state: 'interrupted', requester: 'agent', seen: false }, is('stopped')],

  // Agent Work run: WorkRunStatus.
  ['work blocked', { kind: 'work', status: 'blocked', seen: false }, is('needs-you')],
  ['work failed', { kind: 'work', status: 'failed', seen: true }, is('failed')],
  ['work running', { kind: 'work', status: 'running', seen: false }, is('working')],
  ['work succeeded, unseen', { kind: 'work', status: 'succeeded', seen: false }, is('finished')],
  ['work succeeded, seen', { kind: 'work', status: 'succeeded', seen: true }, is('idle')],
  ['work cancelled', { kind: 'work', status: 'cancelled', seen: false }, is('stopped')]
]

describe('S7.1 agent state mapping (§3.2)', () => {
  it.each(TABLE)('%s', (_name, input, expected) => {
    expect(agentState(input)).toEqual(expected)
  })

  it('covers every source state at least once', () => {
    const seen = (kind: string, field: 'lifecycle' | 'status' | 'state') => new Set(TABLE.map(([, input]) => input).filter(input => input.kind === kind).map(input => (input as Record<string, unknown>)[field]))
    expect([...seen('pane', 'lifecycle')]).toEqual(expect.arrayContaining(['working', 'blocked', 'done', 'idle', 'unknown']))
    expect([...seen('conversation', 'status')]).toEqual(expect.arrayContaining(['idle', 'running', 'approval', 'interrupted', 'failed']))
    expect([...seen('delegation', 'state')]).toEqual(expect.arrayContaining(['preparing', 'starting', 'accepted', 'blocked', 'interrupted', 'failed', 'review', 'approved', 'cancelled']))
    expect([...seen('work', 'status')]).toEqual(expect.arrayContaining(['running', 'succeeded', 'failed', 'blocked', 'cancelled']))
  })

  it('reads a value from a newer store as unknown (the switches are exhaustive at compile time, ARCHITECT M3)', () => {
    expect(agentState({ kind: 'delegation', state: 'paused' as never, requester: 'person', seen: false })).toEqual(is('unknown'))
    expect(agentState({ kind: 'work', status: 'queued' as never, seen: false })).toEqual(is('unknown'))
    expect(agentState({ kind: 'pane', lifecycle: 'sleeping' as never, terminal: 'running', seen: false })).toEqual(is('unknown'))
    expect(agentState({ kind: 'conversation', status: 'paused' as never, pendingRequests: 0, backgroundRunning: 0, seen: false })).toEqual(is('unknown'))
    expect(agentState({ kind: 'robot' } as never)).toEqual(is('unknown'))
    expect(paneToneState('dreaming' as never, { seen: false })).toEqual(is('unknown'))
  })

  it('reaches every one of the seven states, and never unknown for a conversation, a delegation or a run', () => {
    const reached = new Set(TABLE.map(([, , result]) => (result.ended ? null : result.state)))
    for (const value of AGENT_STATES) expect(reached.has(value), value).toBe(true)
    for (const [name, input, result] of TABLE) if (input.kind !== 'pane') expect(result, name).not.toEqual(is('unknown'))
  })

  it('maps the desktop tone the way the sidebar shows it, and an estimate as unknown on main and the phone', () => {
    const tones: [AgentPaneTone, { seen: boolean; stoppedByPerson?: boolean; estimated?: boolean }, AgentStateResult & { estimated?: true }][] = [
      ['needs-decision', { seen: false }, is('needs-you')],
      ['error', { seen: false }, is('failed')],
      ['thinking', { seen: false }, is('working')],
      ['starting', { seen: false }, is('working')],
      ['awaiting', { seen: false }, is('finished')],
      ['awaiting', { seen: true }, is('idle')],
      ['idle', { seen: false }, is('idle')],
      ['exited', { seen: false }, ENDED],
      ['exited', { seen: false, stoppedByPerson: true }, is('stopped')],
      ['thinking', { seen: false, estimated: true }, { ...is('working'), estimated: true }],
      ['awaiting', { seen: false, estimated: true }, { ...is('finished'), estimated: true }]
    ]
    for (const [tone, input, expected] of tones) expect(paneToneState(tone, input), `${tone} ${JSON.stringify(input)}`).toEqual(expected)
    // The same estimated pane, as main sees it: no lifecycle report, so "Not confirmed" (deliberate, §3.2).
    expect(agentState({ kind: 'pane', lifecycle: null, terminal: 'running', seen: false })).toEqual(is('unknown'))
  })

  it('knows every tone the renderer derives', () => {
    const all: Record<PaneDisplayTone, true> = { thinking: true, 'needs-decision': true, awaiting: true, idle: true, error: true, exited: true, starting: true }
    const tones: AgentPaneTone[] = Object.keys(all) as PaneDisplayTone[]
    for (const tone of tones) expect(() => paneToneState(tone, { seen: false })).not.toThrow()
  })

  it('opens each kind in its mode', () => {
    expect(agentMode('pane')).toBe('code')
    expect(agentMode('conversation')).toBe('thread')
    expect(agentMode('work')).toBe('thread')
    expect(agentMode('delegation', 'terminal')).toBe('code')
    expect(agentMode('delegation', 'thread')).toBe('thread')
  })
})

describe('S7.1 order, keys and seen', () => {
  it('sorts by state, longest wait or run first, then newest, then by key (§5.3)', () => {
    const rows = [
      { key: 'pane:idle-old', state: 'idle' as const, since: 1 },
      { key: 'pane:idle-new', state: 'idle' as const, since: 5 },
      { key: 'pane:working-new', state: 'working' as const, since: 9 },
      { key: 'pane:working-old', state: 'working' as const, since: 2 },
      { key: 'conversation:needs-new', state: 'needs-you' as const, since: 8 },
      { key: 'conversation:needs-old', state: 'needs-you' as const, since: 3 },
      { key: 'pane:unknown', state: 'unknown' as const, since: 1 },
      { key: 'work:failed', state: 'failed' as const, since: 1 },
      { key: 'delegation:finished', state: 'finished' as const, since: 1 },
      { key: 'conversation:stopped', state: 'stopped' as const, since: 1 }
    ]
    expect([...rows].sort(compareAgentRows).map(row => row.key)).toEqual([
      'conversation:needs-old', 'conversation:needs-new', 'work:failed', 'pane:working-old', 'pane:working-new', 'delegation:finished',
      'pane:idle-new', 'pane:idle-old', 'conversation:stopped', 'pane:unknown'
    ])
  })

  it('counts needs-you, failed and working on the mode badge', () => {
    expect(AGENT_BADGE_STATES).toEqual(['needs-you', 'failed', 'working'])
  })

  it('builds and reads agent keys, and refuses anything else', () => {
    expect(agentKey('conversation', 't1')).toBe('conversation:t1')
    expect(parseAgentKey('delegation:abc:def')).toEqual({ kind: 'delegation', id: 'abc:def' })
    expect(parseAgentKey(`pane:${'x'.repeat(195)}`)).not.toBeNull()
    for (const value of [null, 1, '', 'pane', 'pane:', 'shell:p1', 'thread:t1', `pane:${'x'.repeat(196)}`, 'pane:a\nb', 'pane:a b', 'pane:é', 'pane:a/b', 'pane:a‮b']) {
      expect(parseAgentKey(value), String(value)).toBeNull()
    }
  })

  it('gives every agent one row: a delegation owns its destination, workers nest under their run (ARCHITECT M2)', () => {
    const ownership = agentOwnership({
      delegations: [{ id: 'd1', paneId: 'p9' }, { id: 'd2', destinationThreadId: 't9' }, { id: 'd3' }],
      workRuns: [{ id: 'r1', workerThreadIds: ['t5', 't6', 't9'] }]
    })
    const rows = ['pane:p1', 'pane:p9', 'conversation:t5', 'conversation:t6', 'conversation:t9', 'conversation:t1', 'delegation:d1', 'delegation:d2', 'delegation:d3', 'work:r1']
      .map(key => ({ key: key as AgentKey, ...(key === 'conversation:t1' ? { parentKey: 'work:other' as AgentKey } : {}) }))
    const listed = applyAgentOwnership(rows, ownership)
    expect(listed.map(row => row.key)).toEqual(['pane:p1', 'conversation:t5', 'conversation:t6', 'conversation:t1', 'delegation:d1', 'delegation:d2', 'delegation:d3', 'work:r1'])
    expect(Object.fromEntries(listed.filter(row => row.parentKey).map(row => [row.key, row.parentKey]))).toEqual({ 'conversation:t5': 'work:r1', 'conversation:t6': 'work:r1', 'conversation:t1': 'work:other' })
    // The worker that is also a delegation's destination is the delegation's, not listed twice.
    expect(ownership.hidden.get('conversation:t9')).toBe('delegation:d2')
    expect(ownership.parents.has('conversation:t9')).toBe(false)
    // Every agent appears exactly once.
    expect(new Set(listed.map(row => row.key)).size).toBe(listed.length)
  })

  it('is seen when the mark is at or after the finish', () => {
    expect(isSeenSince(null, 10)).toBe(false)
    expect(isSeenSince(9, 10)).toBe(false)
    expect(isSeenSince(10, 10)).toBe(true)
    expect(isSeenSince(11, 10)).toBe(true)
  })
})

describe('S7.1 one vocabulary on every surface', () => {
  it('gives every state and the two terminal words a label in agents.state.*, in both languages', () => {
    for (const [language, catalog] of [['en', enCommon], ['pt-BR', ptCommon]] as const) {
      for (const key of [...Object.values(AGENT_STATE_LABEL_KEYS), ...Object.values(AGENT_TERMINAL_LABEL_KEYS)]) {
        expect(typeof lookup(catalog, key), `${language} ${key}`).toBe('string')
      }
    }
  })

  it('uses the glossary words (§5)', () => {
    const words = (catalog: unknown) => Object.fromEntries([...AGENT_STATES.map(value => [value, lookup(catalog, AGENT_STATE_LABEL_KEYS[value])]), ['starting', lookup(catalog, AGENT_TERMINAL_LABEL_KEYS.starting)], ['exited', lookup(catalog, AGENT_TERMINAL_LABEL_KEYS.exited)]])
    expect(words(enCommon)).toEqual({ 'needs-you': 'Needs you', failed: 'Failed', working: 'Working', finished: 'Finished', idle: 'Idle', stopped: 'Stopped', unknown: 'Not confirmed', starting: 'Starting', exited: 'Exited' })
    expect(words(ptCommon)).toEqual({ 'needs-you': 'Precisa de você', failed: 'Falhou', working: 'Trabalhando', finished: 'Terminou', idle: 'Ocioso', stopped: 'Interrompido', unknown: 'Não confirmado', starting: 'Iniciando', exited: 'Encerrado' })
  })

  it('keeps the phone catalog on the same words once it carries them (S7.4)', () => {
    for (const [mobile, common] of [[enMobile, enCommon], [ptMobile, ptCommon]] as const) {
      const phone = lookup(mobile, 'agents.state')
      if (phone !== undefined) expect(phone).toEqual(lookup(common, 'agents.state'))
    }
  })

  it('sends the phone the same states, kinds and risk words as the desktop', () => {
    expect(REMOTE_AGENT_STATES).toEqual(AGENT_STATES)
    expect(REMOTE_AGENT_KINDS).toEqual(AGENT_KINDS)
    expect(REMOTE_APPROVAL_RISKS).toEqual(APPROVAL_RISKS)
  })
})
