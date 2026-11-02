// @vitest-environment node
/**
 * H1 (FINDING on #243) · The window's side of the ack contract, pinned on main. A window that shows a queue acks
 * EVERY request it holds: the one on screen with its real visibility and focus, each one queued behind it with
 * `{ visible: false, focused: false }`. Then no request goes to the system dialog while the window lives. A request
 * the window never acks still goes native after APPROVAL_ACK_TIMEOUT_MS (`no-ack`): the fail-safe stays.
 *
 * HML's run on #243 @6e714a7b acked only the request on screen, so 48 of 50 went native together, 3 s after they came.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApprovalCenter, type NativeReason } from '../../electron/main/services/approvals/approval-center'
import { brokerDraft } from '../../electron/main/services/approvals/drafts'
import { APPROVAL_ACK_TIMEOUT_MS, type ApprovalRequest } from '../../shared/types/approvals'
import { IPC_CHANNELS } from '../../shared/types/ipc'

/** What AgentActions hands the broker for `oxespace_skills_change create` (agent-actions.ts, confirm level). */
const ask = (index: number) => brokerDraft({
  risk: 'action', text: `/acc-${index} — acceptance\n\nnever approved`, kind: 'mcp-confirm',
  requester: { kind: 'agent', id: 'pane:p', label: { code: 'approvals.requester.unknownPane', params: { pane: 1 } } },
  level: 'medium', title: { code: 'approvals.title.agent', params: {} },
  summary: { code: 'approvals.summary.mcpConfirm', params: { tool: 'oxespace_skills_change', action: 'create', target: '/repo' } }, target: '/repo', notes: []
})

function harness() {
  const sent: Array<[string, unknown]> = []
  const native: Array<{ request: ApprovalRequest; reason: NativeReason }> = []
  const center = new ApprovalCenter({
    send: (channel, payload) => { sent.push([channel, payload]) }, hasWindow: () => true,
    native: (request, reason) => new Promise(() => { native.push({ request, reason }) })
  })
  const requested = () => sent.filter(([channel]) => channel === IPC_CHANNELS.approvals.onRequested).map(([, payload]) => payload as ApprovalRequest)
  const burst = (): void => { for (let i = 0; i < 50; i++) void center.ask(ask(i)) }
  return { center, native, requested, burst }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000) })
afterEach(() => { vi.useRealTimers() })

describe('H1 · a burst of 50 internal-MCP confirms in a live window', () => {
  it('the window acks the one on screen and each queued one invisibly: zero native dialogs, however long they wait', () => {
    const h = harness()
    h.burst()
    const requests = h.requested()
    expect(requests).toHaveLength(50)
    expect(requests.every(request => request.kind === 'mcp-confirm' && request.ackRequired)).toBe(true)
    const [onScreen, ...queued] = requests
    expect(h.center.ack({ id: onScreen.id, generation: 1, visible: true, focused: true })).toMatchObject({ ok: true })
    for (const request of queued) expect(h.center.ack({ id: request.id, generation: 1, visible: false, focused: false })).toMatchObject({ ok: true })
    vi.advanceTimersByTime(APPROVAL_ACK_TIMEOUT_MS * 20)
    expect(h.native).toHaveLength(0)
    expect(h.center.list()).toHaveLength(50)
  })

  it('a window that acks only the request on screen (the #243 @6e714a7b behaviour) sends the other 49 native together', () => {
    const h = harness()
    h.burst()
    const [onScreen] = h.requested()
    h.center.ack({ id: onScreen.id, generation: 1, visible: true, focused: true })
    vi.advanceTimersByTime(APPROVAL_ACK_TIMEOUT_MS - 1)
    expect(h.native).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(h.native).toHaveLength(49)
    expect(new Set(h.native.map(item => item.reason))).toEqual(new Set(['no-ack']))
  })

  it('a queued request the window never acks still goes native after the ack timeout, and only that one', () => {
    const h = harness()
    h.burst()
    const requests = h.requested()
    const silent = requests[17]
    for (const request of requests) if (request !== silent) h.center.ack({ id: request.id, generation: 1, visible: request === requests[0], focused: request === requests[0] })
    vi.advanceTimersByTime(APPROVAL_ACK_TIMEOUT_MS)
    expect(h.native.map(item => [item.request.id, item.reason])).toEqual([[silent.id, 'no-ack']])
  })
})
