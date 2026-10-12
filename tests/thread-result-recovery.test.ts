import { describe, expect, it } from 'vitest'
import { recoverPublicTurn } from '../electron/main/services/conversation/thread-result-recovery'
import type { ThreadSnapshot } from '../shared/types/thread'
import type { NativeStateResult } from '../electron/main/services/conversation/codex-state-reader'

const result: NativeStateResult = { state: 'completed', source: 'codex-app-server', nativeTurnId: 'native', observedAt: 100, detail: 'Confirmed', recoveredMessages: [
  { type: 'message', id: 'first', role: 'assistant', text: 'First complete' }, { type: 'message', id: 'second', role: 'assistant', text: 'Second complete' }
] }
function fixture() { return { thread: { status: 'interrupted' }, turns: [{ id: 'user', nativeId: 'native', status: 'interrupted' }], events: [
  { type: 'message', role: 'user', id: 'user', text: 'Request' },
  { type: 'tool', id: 'tool', state: 'unknown', name: 'commandExecution', detail: '' },
  { type: 'message', role: 'assistant', id: 'second', text: 'Partial' },
  { type: 'completed', status: 'interrupted' }
] } as ThreadSnapshot }
describe('confirmed public turn recovery', () => {
  it('requires live confirmation, preserves pending requests and marks missing tool evidence unknown', () => {
    const snapshot = fixture(); snapshot.thread.status = 'running'; snapshot.turns![0].status = 'running'
    const tool = snapshot.events.find(event => event.type === 'tool')!
    if (tool.type === 'tool') tool.state = 'running'
    expect(recoverPublicTurn(snapshot, result)).toBeUndefined()
    const recovered = recoverPublicTurn(snapshot, result, true)!
    expect(recovered.thread.status).toBe('idle')
    expect(recovered.events.find(event => event.type === 'tool')).toMatchObject({ state: 'unknown' })
    expect(tool).toMatchObject({ state: 'running' })
    snapshot.events.push({ type: 'approval', id: 'pending', title: 'Approve', detail: '' })
    expect(recoverPublicTurn(snapshot, result, true)).toBeUndefined()
  })
  it('restores native tool order and replaces unknown evidence without duplicating a tool', () => {
    const snapshot = fixture()
    const recovered = recoverPublicTurn(snapshot, { ...result, recoveredItems: [result.recoveredMessages![0], { type: 'tool', id: 'tool', name: 'commandExecution', state: 'completed', detail: 'npm test', exitCode: 0, output: 'Passed', turnId: 'native' }, result.recoveredMessages![1]] })!
    expect(recovered.events.filter(event => event.type === 'message' && event.role === 'assistant' || event.type === 'tool').map(event => 'id' in event ? event.id : '')).toEqual(['first', 'tool', 'second'])
    expect(recovered.events.find(event => event.type === 'tool')).toMatchObject({ state: 'completed', exitCode: 0, output: 'Passed' })
    expect(snapshot.events.find(event => event.type === 'tool')).toMatchObject({ state: 'unknown' })
  })
  it('restores missing earlier output in native order, replaces partial text and preserves unknown tools', () => {
    const snapshot = fixture(), recovered = recoverPublicTurn(snapshot, result)!
    expect(recovered.events.filter(event => event.type === 'message' && event.role === 'assistant')).toEqual(result.recoveredMessages)
    expect(recovered.events.find(event => event.type === 'tool')).toMatchObject({ state: 'unknown' })
    expect(snapshot.thread.status).toBe('interrupted')
    expect(recoverPublicTurn(recovered, result)?.events).toEqual(recovered.events)
  })
  it('rejects mismatched, active, incomplete and cross-turn message identities', () => {
    expect(recoverPublicTurn(fixture(), { ...result, nativeTurnId: 'other' })).toBeUndefined()
    expect(recoverPublicTurn(fixture(), { ...result, recoveredMessages: undefined })).toBeUndefined()
    expect(recoverPublicTurn(fixture(), { ...result, recoveredMessages: [] })).toBeUndefined()
    const active = fixture(); active.thread.status = 'running'
    expect(recoverPublicTurn(active, result)).toBeUndefined()
    const collision = fixture(); collision.events.unshift({ type: 'message', id: 'first', role: 'assistant', text: 'Previous turn' })
    expect(recoverPublicTurn(collision, result)).toBeUndefined()
  })
  it('can reconcile unknown tools even after the public response was already completed', () => {
    const snapshot = fixture(); snapshot.thread.status = 'idle'; snapshot.turns![0].status = 'completed'
    const input: NativeStateResult = { ...result, recoveredItems: [{ type: 'tool', id: 'tool', name: 'commandExecution', state: 'completed', detail: 'npm test' }, ...result.recoveredMessages!] }
    const recovered = recoverPublicTurn(snapshot, input)!
    expect(recovered.events.find(event => event.type === 'tool')).toMatchObject({ state: 'completed' })
    expect(recoverPublicTurn(recovered, input)).toBeUndefined()
  })
})
