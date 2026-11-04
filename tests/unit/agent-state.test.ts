import { describe, expect, it } from 'vitest'
import { delegationAgentState, paneAgentState, seenSince, threadAgentState, workRunAgentState } from '../../shared/agents/agentState'
import { AGENT_STATES, type AgentState } from '../../shared/types/agents'
import type { AgentLifecycleState } from '../../shared/types/agent-state'
import type { DelegationState } from '../../shared/types/delegation'
import type { ThreadStatus } from '../../shared/types/thread'
import type { WorkRunStatus } from '../../shared/types/work'

/**
 * S7.1 contract (spec §3.2, CCR #513): every state of every source lands in exactly one of the seven. Each table is a
 * Record over the source's own union, so a new source state does not compile until it is placed here.
 */

const PANE: Record<AgentLifecycleState, [unseen: AgentState, seen: AgentState]> = {
  blocked: ['needs-you', 'needs-you'],
  working: ['working', 'working'],
  done: ['finished', 'idle'],
  idle: ['idle', 'idle'],
  unknown: ['unknown', 'unknown']
}

const THREAD: Record<ThreadStatus, AgentState> = {
  approval: 'needs-you',
  failed: 'failed',
  running: 'working',
  idle: 'idle',
  interrupted: 'stopped'
}

const DELEGATION: Record<DelegationState, [personLead: AgentState, agentLead: AgentState]> = {
  preparing: ['working', 'working'],
  starting: ['working', 'working'],
  accepted: ['working', 'working'],
  blocked: ['needs-you', 'working'],
  review: ['needs-you', 'working'],
  failed: ['failed', 'failed'],
  approved: ['finished', 'finished'],
  cancelled: ['stopped', 'stopped'],
  interrupted: ['stopped', 'stopped']
}

const WORK: Record<WorkRunStatus, [unseen: AgentState, seen: AgentState]> = {
  blocked: ['needs-you', 'needs-you'],
  failed: ['failed', 'failed'],
  running: ['working', 'working'],
  succeeded: ['finished', 'idle'],
  cancelled: ['stopped', 'stopped']
}

describe('the seven states', () => {
  it('are exactly these, in precedence order', () => {
    expect([...AGENT_STATES]).toEqual(['needs-you', 'failed', 'working', 'finished', 'idle', 'stopped', 'unknown'])
  })
})

describe('pane', () => {
  it.each(Object.entries(PANE))('%s → unseen / seen', (lifecycle, [unseen, seen]) => {
    expect(paneAgentState({ lifecycle: lifecycle as AgentLifecycleState, seen: false })).toBe(unseen)
    expect(paneAgentState({ lifecycle: lifecycle as AgentLifecycleState, seen: true })).toBe(seen)
  })
  it('the terminal: an error fails it, starting is working; the person stopping it is stopped', () => {
    expect(paneAgentState({ lifecycle: 'idle', terminal: 'error', seen: true })).toBe('failed')
    expect(paneAgentState({ lifecycle: 'unknown', terminal: 'starting', seen: false })).toBe('working')
    expect(paneAgentState({ lifecycle: 'unknown', stoppedByPerson: true, seen: false })).toBe('stopped')
    // Precedence: waiting on the person beats an error beats working.
    expect(paneAgentState({ lifecycle: 'blocked', terminal: 'error', seen: false })).toBe('needs-you')
  })
})

describe('conversation', () => {
  it.each(Object.entries(THREAD))('%s → %s', (status, expected) => {
    expect(threadAgentState({ status: status as ThreadStatus, pendingRequests: 0, backgroundRunning: 0, seen: true })).toBe(expected)
  })
  it('a pending request, or the provider awaiting input, needs you whatever the status', () => {
    expect(threadAgentState({ status: 'idle', pendingRequests: 1, backgroundRunning: 0, seen: true })).toBe('needs-you')
    expect(threadAgentState({ status: 'running', pendingRequests: 0, backgroundRunning: 0, observation: 'awaiting-input', seen: true })).toBe('needs-you')
  })
  it('background work keeps it working; a completed turn is finished until seen', () => {
    expect(threadAgentState({ status: 'idle', pendingRequests: 0, backgroundRunning: 2, seen: true })).toBe('working')
    expect(threadAgentState({ status: 'idle', lastTurnStatus: 'completed', pendingRequests: 0, backgroundRunning: 0, seen: false })).toBe('finished')
    expect(threadAgentState({ status: 'idle', lastTurnStatus: 'completed', pendingRequests: 0, backgroundRunning: 0, seen: true })).toBe('idle')
    expect(threadAgentState({ status: 'idle', lastTurnStatus: 'failed', pendingRequests: 0, backgroundRunning: 0, seen: false })).toBe('idle')
  })
})

describe('delegation', () => {
  it.each(Object.entries(DELEGATION))('%s → person lead / agent lead (unseen)', (state, [person, agent]) => {
    expect(delegationAgentState({ state: state as DelegationState, requesterIsPerson: true, seen: false })).toBe(person)
    expect(delegationAgentState({ state: state as DelegationState, requesterIsPerson: false, seen: false })).toBe(agent)
  })
  it('an approved delegation is idle once seen', () => {
    expect(delegationAgentState({ state: 'approved', requesterIsPerson: true, seen: true })).toBe('idle')
  })
})

describe('work run', () => {
  it.each(Object.entries(WORK))('%s → unseen / seen', (status, [unseen, seen]) => {
    expect(workRunAgentState({ status: status as WorkRunStatus, seen: false })).toBe(unseen)
    expect(workRunAgentState({ status: status as WorkRunStatus, seen: true })).toBe(seen)
  })
})

describe('seen', () => {
  it('counts only a look at or after the last change', () => {
    expect(seenSince(null, 10)).toBe(false)
    expect(seenSince(9, 10)).toBe(false)
    expect(seenSince(10, 10)).toBe(true)
  })
})
