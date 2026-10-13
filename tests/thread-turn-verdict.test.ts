import { describe, expect, it } from 'vitest'
import { failureGuidance, turnEvents, turnVerdict } from '../shared/threadTurnVerdict'
import type { ThreadEvent, ThreadSnapshot, ThreadTurn } from '../shared/types/thread'

const turn = (id: string, status: ThreadTurn['status'], startedAt = 1_000, completedAt = 4_500): ThreadTurn =>
  ({ id, sequence: 0, status, startedAt, completedAt, configuration: {} })

function snapshot(events: ThreadEvent[], turns: ThreadTurn[]): Pick<ThreadSnapshot, 'events' | 'turns'> {
  return { events, turns }
}

describe('turnVerdict', () => {
  const events: ThreadEvent[] = [
    { type: 'message', id: 't1', role: 'user', text: 'First' },
    { type: 'tool', id: 'a', name: 'Bash', detail: '', state: 'completed' },
    { type: 'message', id: 'm1', role: 'assistant', text: 'Done one' },
    { type: 'completed', status: 'completed' },
    { type: 'message', id: 't2', role: 'user', text: 'Second' },
    { type: 'tool', id: 'b', name: 'Edit', detail: '', state: 'completed' },
    { type: 'tool', id: 'c', name: 'Bash', detail: '', state: 'failed' },
    { type: 'turn-diff', turnId: 't2', files: [{ path: 'src/b.ts', kind: 'modified' }, { path: 'src/a.ts', kind: 'added' }] },
    { type: 'message', id: 'm2', role: 'assistant', text: 'Done two' },
    { type: 'completed', status: 'completed' }
  ] as ThreadEvent[]

  it('keeps each turn to its own events', () => {
    const value = snapshot(events, [turn('t1', 'completed'), turn('t2', 'completed')])
    expect(turnEvents(value, 't1').map(event => 'id' in event ? event.id : event.type)).toEqual(['t1', 'a', 'm1', 'completed'])
    expect(turnVerdict(value, 't1')).toEqual({ turnId: 't1', status: 'completed', filesChanged: [], toolCalls: 1, failedToolCalls: 0, unconfirmedToolCalls: 0, durationMs: 3500, summary: 'Done one' })
  })

  it('reports warnings, verified files and the closing message', () => {
    expect(turnVerdict(snapshot(events, [turn('t1', 'completed'), turn('t2', 'completed')]), 't2')).toMatchObject({
      status: 'completed-with-warnings', filesChanged: ['src/a.ts', 'src/b.ts'], toolCalls: 2, failedToolCalls: 1, summary: 'Done two'
    })
  })

  it('carries failure guidance and no summary for a failed turn', () => {
    const failed: ThreadEvent[] = [
      { type: 'message', id: 't1', role: 'user', text: 'Go' },
      { type: 'message', id: 'm', role: 'assistant', text: 'Partial' },
      { type: 'completed', status: 'failed', failure: { id: 'f', occurredAt: 1, code: 'context', message: 'Context full' } }
    ] as ThreadEvent[]
    const verdict = turnVerdict(snapshot(failed, [turn('t1', 'failed')]), 't1')
    expect(verdict).toMatchObject({ status: 'failed', failure: { code: 'context', retryable: false, action: 'compact' } })
    expect(verdict?.summary).toBeUndefined()
  })

  it('is undefined for an unknown turn', () => {
    expect(turnVerdict(snapshot(events, [turn('t1', 'completed')]), 'missing')).toBeUndefined()
  })
})

describe('failureGuidance', () => {
  it('offers retry only where the same turn can succeed again', () => {
    expect(failureGuidance('network')).toMatchObject({ retryable: true, action: 'retry' })
    expect(failureGuidance('authentication')).toMatchObject({ retryable: false, action: 'reconnect' })
    expect(failureGuidance('session-busy').retryable).toBe(false)
    expect(failureGuidance(undefined)).toMatchObject({ retryable: true, title: 'Turn failed' })
    expect(failureGuidance('not-a-code' as never).title).toBe('Turn failed')
  })
})
