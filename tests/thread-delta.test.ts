import { describe, expect, it } from 'vitest'
import { applyThreadDelta } from '../src/store/threadDelta'
import type { ThreadDelta, ThreadEvent, ThreadSnapshot } from '../shared/types/thread'

const message = (id: string, text = id): ThreadEvent => ({ type: 'message', id, role: 'assistant', text })
const thread = { id: 't', status: 'idle' } as ThreadSnapshot['thread']
function base(events: ThreadEvent[], live: number, total = live): ThreadSnapshot {
  return { thread, events, page: { hasMore: false, total, live }, sync: { epoch: 'e', revision: 4 } }
}
const delta = (live: number, events: { seq: number; event: ThreadEvent }[]): Extract<ThreadDelta, { ok: true }> =>
  ({ ok: true, epoch: 'e', revision: 5, live, thread, events, turns: [], deliveries: {}, pendingRequests: [] })

describe('applyThreadDelta', () => {
  it('patches an event in place and appends new ones', () => {
    const merged = applyThreadDelta(base([message('a'), message('b')], 2), delta(3, [{ seq: 1, event: message('b', 'longer') }, { seq: 2, event: message('c') }]))
    expect(merged?.events.map(event => event.type === 'message' && event.text)).toEqual(['a', 'longer', 'c'])
    expect(merged?.page).toMatchObject({ total: 3, live: 3 })
    expect(merged?.sync).toEqual({ epoch: 'e', revision: 5 })
  })

  it('maps seq through the window tail when older events are not loaded', () => {
    // Window shows live seq 98 and 99 of 100.
    const merged = applyThreadDelta(base([message('x98'), message('x99')], 100, 100), delta(100, [{ seq: 99, event: message('x99', 'patched') }, { seq: 3, event: message('old') }]))
    expect(merged?.events.map(event => event.type === 'message' && event.text)).toEqual(['x98', 'patched'])
  })

  it('keeps imported native history in front of the live tail', () => {
    // total counts 2 native + 1 live; seq values of native events are negative and never in a delta.
    const merged = applyThreadDelta(base([message('n1'), message('n2'), message('l0')], 1, 3), delta(2, [{ seq: 0, event: message('l0', 'updated') }, { seq: 1, event: message('l1') }]))
    expect(merged?.events.map(event => event.type === 'message' && event.text)).toEqual(['n1', 'n2', 'updated', 'l1'])
    expect(merged?.page?.total).toBe(4)
  })

  it('refuses a delta with a gap so the caller rereads', () => {
    expect(applyThreadDelta(base([message('a')], 1), delta(3, [{ seq: 2, event: message('c') }]))).toBeNull()
    expect(applyThreadDelta(base([message('a')], 1), delta(2, []))).toBeNull()
    expect(applyThreadDelta({ ...base([message('a')], 1), page: { hasMore: false, total: 1 } }, delta(1, []))).toBeNull()
  })
})
