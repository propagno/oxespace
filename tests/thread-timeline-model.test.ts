import { describe, expect, it } from 'vitest'
import type { ThreadEvent } from '../shared/types/thread'
import { buildThreadTimeline, flattenThreadTimeline } from '../src/components/Threads/threadTimelineModel'
import { computeThreadVirtualRange } from '../src/components/Threads/useThreadVirtualizer'

describe('Thread timeline model', () => {
  it('builds stable turns, filters protocol events and groups adjacent tool activity', () => {
    const events: ThreadEvent[] = [
      { type: 'session', nativeSessionId: 'native' },
      { type: 'message', id: 'user-1', role: 'user', text: 'Inspect' },
      { type: 'tool', id: 'read-1', name: 'Read', state: 'completed', detail: 'a.ts', turnId: 'turn-1' },
      { type: 'tool', id: 'read-2', name: 'Grep', state: 'completed', detail: 'symbol', turnId: 'turn-1' },
      { type: 'configuration', model: 'model' },
      { type: 'turn-diff', id: 'diff-1', turnId: 'turn-1', files: [{ path: 'a.ts', kind: 'update', source: 'native-patch', state: 'completed' }] },
      { type: 'failure-details', id: 'failure-1', usageUnavailable: true },
      { type: 'message', id: 'answer-1', role: 'assistant', text: 'Done' },
      { type: 'completed', status: 'completed' },
      { type: 'message', id: 'user-2', role: 'user', text: 'Continue' }
    ]

    const timeline = buildThreadTimeline(events)
    expect(timeline.map(turn => turn.id)).toEqual(['user-1', 'user-2'])
    expect(timeline[0].rows).toEqual([
      expect.objectContaining({ key: 'user-1:message:user-1', event: expect.objectContaining({ type: 'message' }) }),
      expect.objectContaining({ key: 'user-1:activity:read-1', event: expect.objectContaining({ type: 'activity-group', events: [expect.objectContaining({ id: 'read-1' }), expect.objectContaining({ id: 'read-2' })] }) }),
      expect.objectContaining({ key: 'user-1:message:answer-1', event: expect.objectContaining({ type: 'message' }) }),
      expect.objectContaining({ key: 'user-1:completed:3', event: expect.objectContaining({ type: 'completed' }) })
    ])
    expect(timeline[1].rows[0].key).toBe('user-2:message:user-2')
    expect(timeline[0].events.some(event => event.type === 'turn-diff')).toBe(true)
    expect(timeline[0].rows.some(row => row.event.type === 'turn-diff' || row.event.type === 'failure-details')).toBe(false)
  })

  it('keeps provider output before the first user message in a deterministic initial turn', () => {
    expect(buildThreadTimeline([{ type: 'message', id: 'welcome', role: 'assistant', text: 'Ready' }])).toMatchObject([
      { id: 'initial', rows: [{ key: 'initial:message:welcome' }] }
    ])
  })

  it('flattens semantic rows and caps a 10k row viewport at 80 mounted items', () => {
    const turns = buildThreadTimeline(Array.from({ length: 5_000 }, (_, index) => [
      { type: 'message', id: `u-${index}`, role: 'user', text: 'Question' } as const,
      { type: 'message', id: `a-${index}`, role: 'assistant', text: 'Answer' } as const
    ]).flat())
    const rows = flattenThreadTimeline(turns)
    expect(rows).toHaveLength(10_000)
    expect(rows[0]).toMatchObject({ turnId: 'u-0', firstInTurn: true, lastInTurn: false })
    expect(rows[1]).toMatchObject({ turnId: 'u-0', firstInTurn: false, lastInTurn: true })
    const sizes = rows.map(() => 100), offsets = rows.map((_, index) => index * 100)
    const range = computeThreadVirtualRange(offsets, sizes, 500_000, 900)
    expect(range.end - range.start).toBeLessThanOrEqual(80)
    expect(range.start).toBeLessThan(5_000)
    expect(range.end).toBeGreaterThan(5_000)
  })
})
