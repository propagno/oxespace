import { describe, expect, it } from 'vitest'
import type { ThreadEvent } from '../shared/types/thread'
import { buildThreadTimeline, createThreadTimelineBuilder, flattenThreadTimeline, foldFinishedTurns, summarizeThreadEvents } from '../src/components/Threads/threadTimelineModel'
import { turnFoldLabel, turnTimes } from '../src/components/Threads/ThreadTurnFold'
import { computeThreadVirtualRange } from '../src/components/Threads/useThreadVirtualizer'

describe('Thread timeline model', () => {
  it('leaves background shell commands to the Background activity panel and keeps agents in the reply', () => {
    const task = { type: 'subagent', state: 'completed', agents: [], receiverThreadIds: ['b1'] } as const
    const events = [
      { type: 'message', id: 'user-1', role: 'user', text: 'Build' },
      { ...task, id: 'bg-1', action: 'Background command' },
      { ...task, id: 'agent-1', action: 'Background agent' },
      { type: 'message', id: 'answer-1', role: 'assistant', text: 'Done' }
    ] as ThreadEvent[]
    const ids = buildThreadTimeline(events)[0].rows.map(row => (row.event as { id?: string }).id)
    expect(ids).toEqual(['user-1', 'agent-1', 'answer-1'])
  })
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

describe('folding finished turns', () => {
  const tool = (id: string): ThreadEvent => ({ type: 'tool', id, name: 'Read', state: 'completed', detail: id, turnId: 't' })
  const turn = (prompt: string, middle: ThreadEvent[], end: ThreadEvent[]): ThreadEvent[] => [
    { type: 'message', id: prompt, role: 'user', text: prompt }, ...middle, ...end
  ]
  const keysOf = (events: ThreadEvent[], expanded: string[] = [], unresolved: string[] = []): string[] =>
    flattenThreadTimeline(foldFinishedTurns(buildThreadTimeline(events, 'normal'), new Set(expanded), new Set(unresolved))).map(row => row.key)
  const plan: ThreadEvent = { type: 'plan', id: 'plan-1', steps: [{ label: 'Read', status: 'completed' }] }
  const draft: ThreadEvent = { type: 'message', id: 'draft', role: 'assistant', text: 'Looking' }
  const answer: ThreadEvent = { type: 'message', id: 'answer', role: 'assistant', text: 'Done' }

  it('keeps the prompt and the final answer and folds the work between them', () => {
    const keys = keysOf(turn('ask', [draft, tool('a'), plan, tool('b')], [answer, { type: 'completed', status: 'completed' }]))
    expect(keys).toEqual(['ask:message:ask', 'ask:turn-fold', 'ask:message:answer', 'ask:completed:6'])
  })

  it('shows every row again, after the fold line, once the turn is opened', () => {
    const keys = keysOf(turn('ask', [draft, tool('a'), plan, tool('b')], [answer, { type: 'completed', status: 'completed' }]), ['ask'])
    expect(keys[1]).toBe('ask:turn-fold')
    expect(keys).toContain('ask:message:draft')
    expect(keys).toContain('ask:plan:plan-1')
  })

  it('leaves failed, interrupted, running and short turns open, and any turn with an unresolved request', () => {
    const work = [draft, tool('a'), plan]
    const has = (keys: string[]): boolean => keys.some(key => key.endsWith(':turn-fold'))
    expect(has(keysOf(turn('f', work, [answer, { type: 'completed', status: 'failed', error: 'x' }])))).toBe(false)
    expect(has(keysOf(turn('i', work, [answer, { type: 'completed', status: 'interrupted' }])))).toBe(false)
    expect(has(keysOf(turn('r', work, [answer])))).toBe(false)
    expect(has(keysOf(turn('s', [tool('a')], [answer, { type: 'completed', status: 'completed' }])))).toBe(false)
    const request: ThreadEvent = { type: 'request', id: 'q', request: { id: 'q', nativeId: 'q', nativeMethod: 'm', kind: 'question', title: 'Which?', generation: 1, createdAt: 1, state: 'pending' } }
    expect(has(keysOf(turn('q', [...work, request], [answer, { type: 'completed', status: 'completed' }]), [], ['q']))).toBe(false)
  })

  it('counts each action of a group as a step and names the duration', () => {
    const folded = foldFinishedTurns(buildThreadTimeline(turn('ask', [draft, tool('a'), tool('b'), tool('c')], [answer, { type: 'completed', status: 'completed' }]), 'normal'), new Set())
    const fold = folded[0].rows.find(row => row.event.type === 'turn-fold')!.event as { steps: number }
    expect(fold.steps).toBe(4)
    expect(turnFoldLabel(4, { id: 'ask', sequence: 1, status: 'completed', startedAt: 0, completedAt: 63_000, configuration: {} as never })).toBe('Completed 4 steps in 1m 3s')
    expect(turnFoldLabel(1)).toBe('Completed 1 step')
  })

  it('folds a thought away with the work but does not count it as a step', () => {
    const thought: ThreadEvent = { type: 'reasoning', id: 'think', text: 'Plan the change', startedAt: 0, completedAt: 1_000 }
    const folded = foldFinishedTurns(buildThreadTimeline(turn('ask', [thought, tool('a'), tool('b')], [answer, { type: 'completed', status: 'completed' }]), 'normal'), new Set())
    expect(folded[0].rows.some(row => row.event.type === 'reasoning')).toBe(false)
    expect((folded[0].rows.find(row => row.event.type === 'turn-fold')!.event as { steps: number }).steps).toBe(2)
  })

  it('leaves the time spent waiting for the person out of the turn duration, counting overlaps once', () => {
    const turn = { id: 'ask', sequence: 1, status: 'completed' as const, startedAt: 0, completedAt: 100_000, configuration: {} as never }
    const request = (id: string, createdAt: number, resolvedAt?: number): ThreadEvent => ({ type: 'request', id, request: { id, nativeId: id, nativeMethod: 'x', kind: 'approval', title: 'Allow', generation: 0, createdAt, state: resolvedAt ? 'resolved' : 'pending', ...(resolvedAt ? { resolvedAt } : {}) } } as ThreadEvent)
    const events: ThreadEvent[] = [
      request('a', 10_000, 40_000),
      request('b', 30_000, 50_000),
      request('c', 70_000),
      { type: 'request-resolved', id: 'c', state: 'resolved', resolvedAt: 80_000 }
    ]
    expect(turnTimes(turn, events)).toEqual({ totalMs: 100_000, waitedMs: 50_000, workedMs: 50_000 })
    expect(turnFoldLabel(3, turn, events)).toBe('Completed 3 steps in 50s')
    // A request never answered is a wait until the turn ended.
    expect(turnTimes(turn, [request('d', 90_000)])?.waitedMs).toBe(10_000)
    expect(turnTimes({ ...turn, completedAt: undefined })).toBeUndefined()
  })
})

describe('Incremental Thread timeline', () => {
  const turnOf = (n: number): ThreadEvent[] => [
    { type: 'message', id: `u-${n}`, role: 'user', text: `Prompt ${n}` },
    { type: 'message', id: `m-${n}`, role: 'assistant', text: 'Looking' },
    { type: 'tool', id: `r-${n}`, name: 'Read', state: 'completed', detail: 'a.ts', turnId: `t-${n}` },
    { type: 'tool', id: `g-${n}`, name: 'Grep', state: 'completed', detail: 'b', turnId: `t-${n}` },
    { type: 'turn-diff', id: `d-${n}`, turnId: `t-${n}`, files: [] },
    { type: 'message', id: `a-${n}`, role: 'assistant', text: `Answer ${n}` },
    { type: 'completed', status: 'completed' }
  ]
  const history = (turns: number): ThreadEvent[] => Array.from({ length: turns }, (_, n) => turnOf(n)).flat()

  it('matches the full build and reuses every turn a streamed append left alone', () => {
    const build = createThreadTimelineBuilder()
    const events = history(3)
    const first = build(events, 'normal')
    expect(first).toEqual(buildThreadTimeline(events, 'normal'))
    // A delta keeps the earlier event objects and appends (store/threadDelta.ts).
    const appended = [...events, { type: 'message', id: 'u-3', role: 'user', text: 'Next' } as ThreadEvent, { type: 'message', id: 'a-3', role: 'assistant', text: 'Streaming' } as ThreadEvent]
    const second = build(appended, 'normal')
    expect(second).toEqual(buildThreadTimeline(appended, 'normal'))
    expect(second.slice(0, 3).every((turn, index) => turn === first[index])).toBe(true)
    // The last turn's answer grows: only that turn is rebuilt.
    const grown = [...appended.slice(0, -1), { type: 'message', id: 'a-3', role: 'assistant', text: 'Streaming more' } as ThreadEvent]
    const third = build(grown, 'normal')
    expect(third).toEqual(buildThreadTimeline(grown, 'normal'))
    expect(third[2]).toBe(second[2])
    expect(third[3]).not.toBe(second[3])
  })

  it('rebuilds turns whose events are new objects, and everything when the view mode changes', () => {
    const build = createThreadTimelineBuilder()
    const events = history(2)
    const first = build(events, 'normal')
    const reread = structuredClone(events)
    const fromReread = build(reread, 'normal')
    expect(fromReread).toEqual(first)
    expect(fromReread[0]).not.toBe(first[0])
    const verbose = build(reread, 'verbose')
    expect(verbose).toEqual(buildThreadTimeline(reread, 'verbose'))
    expect(verbose[0]).not.toBe(fromReread[0])
  })

  it('folds and flattens reused turns to the same objects, and follows a fold being opened', () => {
    const build = createThreadTimelineBuilder()
    const events = history(2)
    const folded = foldFinishedTurns(build(events, 'normal'), new Set())
    const again = foldFinishedTurns(build([...events], 'normal'), new Set())
    expect(again[0]).toBe(folded[0])
    expect(flattenThreadTimeline(again)[0]).toBe(flattenThreadTimeline(folded)[0])
    const opened = foldFinishedTurns(build(events, 'normal'), new Set(['u-0']))
    expect(opened[0]).not.toBe(folded[0])
    expect(opened[0].rows.find(row => row.event.type === 'turn-fold')?.event).toMatchObject({ expanded: true })
    expect(opened).toEqual(foldFinishedTurns(buildThreadTimeline(events, 'normal'), new Set(['u-0'])))
    expect(flattenThreadTimeline(opened)).toEqual(flattenThreadTimeline(foldFinishedTurns(buildThreadTimeline(events, 'normal'), new Set(['u-0']))))
  })

  it('summarizes the last result, message and prompt and the pending requests in one pass', () => {
    const pending = { id: 'q', nativeId: 'q', nativeMethod: 'm', kind: 'approval', title: 'Approve', generation: 1, createdAt: 1, state: 'pending' } as const
    const events = [...history(1), { type: 'request', id: 'q', request: pending }, { type: 'request', id: 'done', request: { ...pending, id: 'done', state: 'resolved' } }] as ThreadEvent[]
    const summary = summarizeThreadEvents(events)
    expect(summary.lastResult).toBe(events[6])
    expect(summary.lastMessage).toBe(events[5])
    expect(summary.lastPrompt).toBe(events[0])
    expect(summary.pendingRequests).toEqual([pending])
    expect(summarizeThreadEvents([])).toEqual({ pendingRequests: [] })
  })
})
