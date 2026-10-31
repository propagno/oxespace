import { describe, expect, it } from 'vitest'
import { reduceThreadEvent, type ReduceContext } from '../electron/main/services/conversation/kernel/event-reducer'
import type { ThreadSnapshot } from '../shared/types/thread'

const ctx = (over: Partial<ReduceContext> = {}): ReduceContext => ({
  now: () => 1000,
  pendingRequestCount: () => 0,
  invalidated: [],
  needsVerifiedDiff: false,
  needsCheckpoint: false,
  ...over
})

function snapshot(over: Partial<ThreadSnapshot> = {}): ThreadSnapshot {
  return {
    thread: { id: 't', workspaceId: 'w', projectId: 'p', rootPath: '/r', provider: 'codex', nativeSessionId: null, title: 'T', pinned: false, status: 'running', createdAt: 0, updatedAt: 0 },
    events: [{ type: 'message', id: 'turn-1', role: 'user', text: 'go' }],
    turns: [{ id: 'turn-1', operationId: 'op-1', sequence: 1, status: 'running', configuration: {} }],
    ...over
  } as ThreadSnapshot
}

const kinds = (effects: { kind: string }[]): string[] => effects.map(e => e.kind)

describe('reduceThreadEvent', () => {
  it('a completed turn settles running tools, releases ownership and drains the queue', () => {
    const s = snapshot()
    s.events.push({ type: 'tool', id: 'x', name: 'Bash', state: 'running', detail: 'make' })
    const r = reduceThreadEvent(s, { type: 'completed', status: 'completed' }, ctx())
    expect(s.events.find(e => e.type === 'tool')).toMatchObject({ state: 'unknown', completedAt: 1000 })
    expect(s.thread.status).toBe('idle')
    expect(s.turns![0]).toMatchObject({ status: 'completed', completedAt: 1000 })
    expect(kinds(r.before)).toEqual(['busy-delete', 'operation'])
    expect(r.before[1]).toMatchObject({ operationId: 'op-1', state: 'completed' })
    expect(kinds(r.after)).toEqual(['drain', 'refresh-context', 'memory-event'])
    expect(r.save).toMatchObject({ eventsFrom: 1, operationId: 'op-1' })
  })

  it('finalises instead of draining when a diff baseline or checkpoint is open', () => {
    const r = reduceThreadEvent(snapshot(), { type: 'completed', status: 'failed', error: 'boom' }, ctx({ needsCheckpoint: true }))
    expect(kinds(r.before)).toEqual(['busy-delete', 'finalizing-add', 'operation'])
    expect(r.before[2]).toMatchObject({ state: 'failed', error: 'boom' })
    expect(r.after[0]).toMatchObject({ kind: 'finalize', status: 'failed', turnId: 'turn-1', captureDiff: false })
  })

  it('a stopped turn with queued input pauses the queue instead of starting it', () => {
    const s = snapshot()
    s.thread.queue = [{ id: 'q', text: 'next', createdAt: 0, state: 'queued' }]
    reduceThreadEvent(s, { type: 'completed', status: 'interrupted' }, ctx())
    expect(s.thread.queuePause).toEqual({ reason: 'interrupted', since: 1000, turnId: 'turn-1' })
  })

  it('records invalidated requests and closes unresolved approvals when the turn ends', () => {
    const s = snapshot()
    s.events.push({ type: 'request', id: 'r', request: { id: 'r', nativeId: 'r', nativeMethod: 'm', kind: 'approval', title: 'A', generation: 1, createdAt: 0, state: 'pending' } })
    s.events.push({ type: 'approval', id: 'a', title: 'A', detail: '' })
    reduceThreadEvent(s, { type: 'completed', status: 'interrupted' }, ctx({ invalidated: [{ id: 'r', state: 'cancelled', resolvedAt: 5 }] }))
    expect(s.events.find(e => e.type === 'request')).toMatchObject({ request: { state: 'cancelled', resolution: 'interrupted', resolvedAt: 5 } })
    expect(s.events.some(e => e.type === 'request-resolved' && e.id === 'r')).toBe(true)
    expect(s.events.some(e => e.type === 'approval-resolved' && e.id === 'a')).toBe(true)
  })

  it('a resolved request returns the thread to running unless others are pending', () => {
    const s = snapshot()
    s.events.push({ type: 'request', id: 'r', request: { id: 'r', nativeId: 'r', nativeMethod: 'm', kind: 'approval', title: 'A', generation: 1, createdAt: 0, state: 'pending' } })
    s.thread.status = 'approval'
    reduceThreadEvent(s, { type: 'request-resolved', id: 'r', state: 'accepted', resolution: 'accepted' }, ctx({ pendingRequestCount: () => 0 }))
    expect(s.thread.status).toBe('running')
    expect(s.events.find(e => e.type === 'request')).toMatchObject({ request: { state: 'accepted', resolvedAt: 1000 } })
    reduceThreadEvent(s, { type: 'request-resolved', id: 'other', state: 'accepted' }, ctx({ pendingRequestCount: () => 2 }))
    expect(s.thread.status).toBe('approval')
  })

  it('merges a tool result into its call without losing the original name', () => {
    const s = snapshot()
    reduceThreadEvent(s, { type: 'tool', id: 'x', name: 'Bash', state: 'running', detail: 'ls', turnId: 'native-1' }, ctx())
    const r = reduceThreadEvent(s, { type: 'tool', id: 'x', name: 'Tool result', state: 'completed', detail: '', output: 'a' }, ctx())
    expect(s.events.filter(e => e.type === 'tool')).toEqual([expect.objectContaining({ name: 'Bash', detail: 'ls', state: 'completed', output: 'a' })])
    expect(s.turns![0].nativeId).toBe('native-1')
    expect(r.before).toContainEqual({ kind: 'operation', operationId: 'op-1', state: 'running' })
  })

  it('appends deltas to one assistant message', () => {
    const s = snapshot()
    reduceThreadEvent(s, { type: 'delta', id: 'm', text: 'Hel' }, ctx())
    const r = reduceThreadEvent(s, { type: 'delta', id: 'm', text: 'lo' }, ctx())
    expect(s.events.filter(e => e.type === 'message' && e.role === 'assistant')).toEqual([{ type: 'message', id: 'm', role: 'assistant', text: 'Hello' }])
    expect(r.save?.eventsFrom).toBe(1)
  })

  it('a provider continuation opens a turn and takes ownership once', () => {
    const s = snapshot({ turns: [{ id: 'turn-1', sequence: 1, status: 'completed', configuration: {} }] })
    s.thread.status = 'idle'
    const r = reduceThreadEvent(s, { type: 'continuation-started', id: 'c', at: 7 }, ctx())
    expect(s.turns).toHaveLength(2)
    expect(s.thread.status).toBe('running')
    expect(kinds(r.before)).toEqual(['busy-add'])
    const again = reduceThreadEvent(s, { type: 'continuation-started', id: 'c2', at: 8 }, ctx())
    expect(again.before).toEqual([])
    expect(s.turns).toHaveLength(2)
  })

  it('ignores turn acceptance and failure details that no longer apply', () => {
    const idle = snapshot({ turns: [{ id: 'turn-1', sequence: 1, status: 'completed', configuration: {} }] })
    expect(reduceThreadEvent(idle, { type: 'turn-accepted', nativeTurnId: 'n', at: 1 }, ctx()).save).toBeNull()
    expect(reduceThreadEvent(snapshot(), { type: 'failure-details', id: 'missing' }, ctx()).save).toBeNull()
  })

  it('configuration updates the thread and the running turn, and refreshes capabilities', () => {
    const s = snapshot()
    const r = reduceThreadEvent(s, { type: 'configuration', model: 'big', access: 'workspace-write' }, ctx())
    expect(s.thread).toMatchObject({ model: 'big', access: 'workspace-write' })
    expect(s.turns![0].configuration).toMatchObject({ model: 'big', access: 'workspace-write' })
    expect(kinds(r.before)).toEqual(['refresh-capabilities'])
  })
})

describe('tool-call transitions in the reducer', () => {
  it('a late "running" report never revives a finished or settled call', () => {
    const s = snapshot()
    reduceThreadEvent(s, { type: 'tool', id: 'x', name: 'Bash', state: 'running', detail: 'make' }, ctx())
    reduceThreadEvent(s, { type: 'tool', id: 'x', name: 'Tool result', state: 'completed', detail: '', output: 'ok', completedAt: 50 }, ctx())
    reduceThreadEvent(s, { type: 'tool', id: 'x', name: 'Bash', state: 'running', detail: 'make' }, ctx())
    expect(s.events.find(e => e.type === 'tool')).toMatchObject({ state: 'completed', output: 'ok', completedAt: 50 })

    const u = snapshot()
    u.events.push({ type: 'tool', id: 'y', name: 'Bash', state: 'unknown', detail: 'x' })
    reduceThreadEvent(u, { type: 'tool', id: 'y', name: 'Bash', state: 'running', detail: 'x' }, ctx())
    expect(u.events.find(e => e.type === 'tool')).toMatchObject({ state: 'unknown' })
  })

  it('an unknown call can still learn its real outcome', () => {
    const s = snapshot()
    s.events.push({ type: 'tool', id: 'y', name: 'Bash', state: 'unknown', detail: 'x' })
    reduceThreadEvent(s, { type: 'tool', id: 'y', name: 'Tool result', state: 'failed', detail: '', exitCode: 2 }, ctx())
    expect(s.events.find(e => e.type === 'tool')).toMatchObject({ state: 'failed', exitCode: 2, name: 'Bash' })
  })
})
