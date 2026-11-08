// Frozen acceptance test for 1.5.0 A56 / N6 (OXE program, phase F7), SECURITY: a pending approval raises a system
// notification at once, only when the window is not focused, with one action, Open, never Allow. A third request
// within 10 s replaces the open ones with one grouped notification. Open focuses the window and asks it to open that
// request. Fake notifications and fake timers only. Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f7-approvals.md §A56; DESIGN 1.5.0-f7-design.md U7.5.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApprovalNotifier } from '../../../electron/main/services/approvals/approval-notifier'

afterEach(() => { vi.useRealTimers() })
interface Shown { title: { code: string; params: Record<string, unknown> }; body: string; actions: string[]; onAction: (action: string) => void; closed: boolean }
function setup(focused = false, enabled = true) {
  vi.useFakeTimers()
  const shown: Shown[] = []
  const opened: string[] = []
  const focus = vi.fn()
  const notifier = new ApprovalNotifier({
    show: notification => { const entry: Shown = { ...notification, closed: false }; shown.push(entry); return { close: () => { entry.closed = true } } },
    focused: () => focused, enabled: () => enabled, focusWindow: focus, openRequest: requestId => { opened.push(requestId) }
  })
  const visible = () => shown.filter(entry => !entry.closed)
  return { notifier, shown, visible, opened, focus }
}
const request = (id: string, title = 'run npm publish') => ({ requestId: id, threadId: 't1', agent: 'Claude', title })

describe('A56 · the system notification', () => {
  test('A56: an unfocused window gets a notification at once, with only Open; the body is the title, cut at 80', () => {
    const { notifier, visible } = setup()
    notifier.pending(request('r1', 'x'.repeat(200)))
    expect(visible()).toHaveLength(1)
    expect(visible()[0].actions).toEqual(['open'])
    expect(visible()[0].body.length).toBeLessThanOrEqual(80)
    expect(visible()[0].title).toEqual({ code: 'notify.agentNeedsYou', params: { agent: 'Claude' } })
    expect(JSON.stringify(visible())).not.toMatch(/allow|approve/i)
  })

  test('A56: Open focuses the window and opens that request; any other action does nothing', () => {
    const { notifier, visible, opened, focus } = setup()
    notifier.pending(request('r1'))
    visible()[0].onAction('allow')
    expect(opened).toEqual([])
    visible()[0].onAction('open')
    expect(focus).toHaveBeenCalledTimes(1)
    expect(opened).toEqual(['r1'])
  })

  test('A56: with the window focused there is no system notification (the window shows its toast); the setting off shows nothing', () => {
    const focused = setup(true)
    focused.notifier.pending(request('r1'))
    expect(focused.shown).toEqual([])
    vi.useRealTimers()
    const off = setup(false, false)
    off.notifier.pending(request('r1'))
    expect(off.shown).toEqual([])
  })

  test('A56: a third request within 10 s replaces the open ones with one grouped notification; Open then opens the first', () => {
    const { notifier, visible, opened } = setup()
    notifier.pending(request('r1')); notifier.pending(request('r2'))
    expect(visible()).toHaveLength(2)
    notifier.pending(request('r3'))
    expect(visible()).toHaveLength(1)
    expect(visible()[0].title).toEqual({ code: 'notify.requestsNeedYou', params: { count: 3 } })
    notifier.pending(request('r4'))
    expect(visible()).toHaveLength(1)
    expect(visible()[0].title.params).toEqual({ count: 4 })
    visible()[0].onAction('open')
    expect(opened).toEqual(['r1'])
  })

  test('A56: requests more than 10 s apart are not grouped; an answered request closes its notification', async () => {
    const { notifier, visible } = setup()
    notifier.pending(request('r1')); notifier.pending(request('r2'))
    await vi.advanceTimersByTimeAsync(11_000)
    notifier.pending(request('r3'))
    expect(visible()).toHaveLength(3)
    notifier.resolved('r2')
    expect(visible()).toHaveLength(2)
  })
})
