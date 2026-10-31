import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApprovalCenter, type ApprovalDraft, type NativeReason } from '../electron/main/services/approvals/approval-center'
import { ALLOW_ONCE, ALLOW_SESSION_READS, crashDraft, DENY } from '../electron/main/services/approvals/drafts'
import { approvalRequestProblems } from '../shared/approval-rules'
import { mainMessage } from '../shared/messages'
import { APPROVAL_ACK_TIMEOUT_MS, APPROVAL_AGENT_TEXT_MAX, APPROVAL_QUEUE_MAX, APPROVAL_TIMEOUT_MS, type ApprovalRequest, type ApprovalRisk } from '../shared/types/approvals'
import { IPC_CHANNELS } from '../shared/types/ipc'

const draft = (risk: ApprovalRisk = 'medium', patch: Partial<ApprovalDraft> = {}): ApprovalDraft => ({
  kind: 'oxequery', risk, requester: { kind: 'agent', id: 'pane:p1', label: mainMessage('approvals.requester.pane', { agent: 'Claude', pane: 1 }) },
  title: mainMessage('approvals.title.oxequery', {}), summary: mainMessage('approvals.summary.oxequery.write', {}), appNotes: [],
  text: 'UPDATE t SET a = 1 WHERE id = 2', options: [DENY, ALLOW_ONCE], defaultOptionId: DENY.id, ...patch
})

function harness(options: { window?: boolean; queueMax?: number } = {}) {
  let window = options.window ?? true
  const sent: Array<[string, unknown]> = []
  const native: Array<{ request: ApprovalRequest; reason: NativeReason; answer(optionId: string | null): void }> = []
  const log = vi.fn()
  const center = new ApprovalCenter({
    send: (channel, payload) => { sent.push([channel, payload]) },
    hasWindow: () => window,
    native: (request, reason) => new Promise(resolve => { native.push({ request, reason, answer: resolve }) }),
    log, ...(options.queueMax ? { queueMax: options.queueMax } : {})
  })
  const requested = () => sent.filter(([channel]) => channel === IPC_CHANNELS.approvals.onRequested).map(([, payload]) => payload as ApprovalRequest)
  const resolved = () => sent.filter(([channel]) => channel === IPC_CHANNELS.approvals.onResolved).map(([, payload]) => payload)
  return { center, sent, native, log, requested, resolved, closeWindow: () => { window = false } }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000) })
afterEach(() => { vi.useRealTimers() })

describe('approval center: an agent request needs the window to say it is shown', () => {
  it('an acknowledged agent request stays in the window: no native dialog, however long it waits', async () => {
    const h = harness()
    const outcome = h.center.ask(draft())
    const [request] = h.requested()
    expect(request.ackRequired).toBe(true)
    h.center.ack({ id: request.id, generation: 1, visible: true, focused: true })
    vi.advanceTimersByTime(APPROVAL_ACK_TIMEOUT_MS * 10)
    expect(h.native).toHaveLength(0)
    h.center.respond({ id: request.id, generation: 1, optionId: 'allow-once' })
    await expect(outcome).resolves.toMatchObject({ intent: 'allow', by: 'user' })
  })

  it('with no panel to acknowledge it, an agent request goes to the native dialog after 3 s', async () => {
    const h = harness()
    const outcome = h.center.ask(draft())
    vi.advanceTimersByTime(APPROVAL_ACK_TIMEOUT_MS - 1)
    expect(h.native).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(h.native).toHaveLength(1)
    expect(h.native[0].reason).toBe('no-ack')
    h.native[0].answer('allow-once')
    await expect(outcome).resolves.toMatchObject({ intent: 'allow', by: 'native' })
  })

  it('still goes native when the ack timer fires before the clock says 3 s (Windows timer resolution)', async () => {
    // When the 3 s timer fires, the clock reads 5 ms short of it, so the rule reads 2,995 ms and says "wait".
    let lag = 0
    const native: Array<(optionId: string | null) => void> = []
    const center = new ApprovalCenter({
      send: () => {}, hasWindow: () => true, now: () => Date.now() - lag,
      native: () => new Promise(resolve => { native.push(resolve) })
    })
    const outcome = center.ask(draft())
    lag = 5
    vi.advanceTimersByTime(APPROVAL_ACK_TIMEOUT_MS)
    expect(native).toHaveLength(0)
    lag = 0
    vi.advanceTimersByTime(5)
    expect(native).toHaveLength(1)
    native[0]('deny')
    await expect(outcome).resolves.toMatchObject({ intent: 'deny', by: 'native' })
  })

  it('stops checking once the window acknowledges the request', () => {
    let lag = 0
    const native: unknown[] = []
    const center = new ApprovalCenter({ send: () => {}, hasWindow: () => true, now: () => Date.now() - lag, native: async request => { native.push(request); return null } })
    void center.ask(draft())
    lag = 5
    vi.advanceTimersByTime(APPROVAL_ACK_TIMEOUT_MS)
    const [request] = center.list()
    lag = 0
    center.ack({ id: request.id, generation: 1, visible: true, focused: true })
    vi.advanceTimersByTime(APPROVAL_ACK_TIMEOUT_MS * 10)
    expect(native).toHaveLength(0)
  })

  it('an MCP server request needs the ack too; only the app\'s own prompts may wait for the window', () => {
    const h = harness()
    void h.center.ask(draft('medium', { requester: { kind: 'mcp-server', id: 's1', label: mainMessage('approvals.requester.pane', { agent: 'Claude', pane: 1 }) } }))
    void h.center.ask(draft('low', { requester: { kind: 'app', id: 'app', label: mainMessage('approvals.requester.pane', { agent: 'Claude', pane: 1 }) } }))
    expect(h.requested().map(request => request.ackRequired)).toEqual([true, false])
  })
})

describe('approval center: the window first (B10)', () => {
  it('sends the request to the window, never to the native dialog, and returns the one answer', async () => {
    const h = harness()
    const outcome = h.center.ask(draft())
    const [request] = h.requested()
    expect(request).toMatchObject({ schemaVersion: 1, generation: 1, kind: 'oxequery', risk: 'medium', allowDelayMs: 0, enterDisabled: false, defaultOptionId: 'deny' })
    expect(request.agentText).toEqual({ text: 'UPDATE t SET a = 1 WHERE id = 2', untrusted: true, length: 31, truncated: false })
    expect(h.center.list()).toEqual([request])
    expect(h.center.ack({ id: request.id, generation: 1, visible: true, focused: true })).toEqual({ ok: true, id: request.id })
    expect(h.center.respond({ id: request.id, generation: 1, optionId: 'allow-once' })).toEqual({ ok: true, id: request.id })
    await expect(outcome).resolves.toEqual({ intent: 'allow', optionId: 'allow-once', by: 'user' })
    expect(h.native).toHaveLength(0)
    expect(h.resolved()).toEqual([{ id: request.id, generation: 1, outcome: 'allow', optionId: 'allow-once', by: 'user' }])
    expect(h.center.history()[0]).toMatchObject({ id: request.id, outcome: 'allow', by: 'user', textSha256: expect.stringMatching(/^[0-9a-f]{64}$/) })
    // A person's own decision carries no reason.
    expect(h.center.history()[0].reason).toBeUndefined()
  })

  it('accepts exactly one answer: a second, a stale generation, an unknown id or option is refused with its code', async () => {
    const h = harness()
    void h.center.ask(draft())
    const [request] = h.requested()
    expect(h.center.respond({ id: request.id, generation: 2, optionId: 'deny' })).toMatchObject({ ok: false, refusal: 'staleGeneration', message: { code: 'approvals.refused.staleGeneration' } })
    expect(h.center.respond({ id: request.id, generation: 1, optionId: 'allow-session' })).toMatchObject({ ok: false, refusal: 'unknownOption' })
    expect(h.center.respond({ id: 'nope', generation: 1, optionId: 'deny' })).toMatchObject({ ok: false, refusal: 'notPending' })
    expect(h.center.respond({ id: request.id, generation: 1, optionId: 'deny' })).toMatchObject({ ok: true })
    expect(h.center.respond({ id: request.id, generation: 1, optionId: 'allow-once' })).toMatchObject({ ok: false, refusal: 'alreadyAnswered', message: { code: 'approvals.refused.alreadyAnswered' } })
    expect(h.center.ack({ id: request.id, generation: 1, visible: true, focused: true })).toMatchObject({ ok: false, refusal: 'alreadyAnswered' })
  })

  it('denies an unanswered request after APPROVAL_TIMEOUT_MS and tells the window', async () => {
    const h = harness()
    const outcome = h.center.ask(draft())
    vi.advanceTimersByTime(APPROVAL_TIMEOUT_MS)
    await expect(outcome).resolves.toEqual({ intent: 'deny', optionId: 'deny', by: 'timeout' })
    expect(h.resolved()).toEqual([expect.objectContaining({ outcome: 'deny', by: 'timeout' })])
    expect(h.center.history()[0]).toMatchObject({ by: 'timeout', reason: { code: 'approvals.denied.timeout' } })
  })

  it('closes the modal when the source cancels the request', async () => {
    const h = harness()
    const controller = new AbortController()
    const outcome = h.center.ask(draft(), controller.signal)
    controller.abort()
    await expect(outcome).resolves.toMatchObject({ intent: 'deny', by: 'cancelled' })
    expect(h.resolved()).toEqual([expect.objectContaining({ by: 'cancelled' })])
    expect(h.center.history()[0]).toMatchObject({ by: 'cancelled', reason: { code: 'approvals.denied.cancelled' } })
    expect(h.center.list()).toEqual([])
  })

  it('keeps "allow for this run" for low risk only', () => {
    const h = harness()
    void h.center.ask(draft('low', { options: [DENY, ALLOW_ONCE, ALLOW_SESSION_READS] }))
    void h.center.ask(draft('medium', { options: [DENY, ALLOW_ONCE, ALLOW_SESSION_READS] }))
    expect(h.requested().map(request => request.options.map(option => option.id))).toEqual([['deny', 'allow-once', 'allow-session'], ['deny', 'allow-once']])
  })
})

describe('approval center: critical pacing, enforced by main (B10)', () => {
  const critical = () => {
    const h = harness()
    const outcome = h.center.ask(draft('critical', { text: 'DROP TABLE orders' }))
    const [request] = h.requested()
    return { h, outcome, request, answer: (optionId: string) => h.center.respond({ id: request.id, generation: 1, optionId }) }
  }

  it('sends the pacing the window honours: Allow held for 2 s, Enter off, deny by default', () => {
    const { request } = critical()
    expect(request).toMatchObject({ risk: 'critical', allowDelayMs: 2_000, enterDisabled: true, defaultOptionId: 'deny' })
    expect(approvalRequestProblems(request)).toEqual([])
  })

  it('refuses an allow at 1,999 ms after the ack and keeps the request pending', () => {
    const { h, request, answer } = critical()
    h.center.ack({ id: request.id, generation: 1, visible: true, focused: true })
    vi.advanceTimersByTime(1_999)
    expect(answer('allow-once')).toMatchObject({ ok: false, refusal: 'tooSoon', message: { code: 'approvals.refused.tooSoon' } })
    expect(h.center.list().map(item => item.id)).toEqual([request.id])
  })

  it('accepts an allow at 2,000 ms after the ack', async () => {
    const { h, request, answer, outcome } = critical()
    h.center.ack({ id: request.id, generation: 1, visible: true, focused: true })
    vi.advanceTimersByTime(2_000)
    expect(answer('allow-once')).toEqual({ ok: true, id: request.id })
    await expect(outcome).resolves.toMatchObject({ intent: 'allow', by: 'user' })
  })

  it('refuses an allow with no display confirmation, however late (R1: not shown at all)', () => {
    const { answer } = critical()
    vi.advanceTimersByTime(60_000)
    expect(answer('allow-once')).toMatchObject({ ok: false, refusal: 'notShown' })
  })

  it('keeps asking for attention a best-effort extra', () => {
    const center = new ApprovalCenter({ send: () => {}, hasWindow: () => true, native: async () => null, attention: () => { throw new Error('no frame') } })
    void center.ask(draft())
    expect(center.list()).toHaveLength(1)
  })

  it('accepts a deny at 0 ms, with or without the ack', async () => {
    const { answer, outcome } = critical()
    expect(answer('deny')).toMatchObject({ ok: true })
    await expect(outcome).resolves.toMatchObject({ intent: 'deny', by: 'user' })
  })

  it.each(['low', 'medium', 'high'] as const)('does not delay %s risk', async risk => {
    const h = harness()
    const outcome = h.center.ask(draft(risk))
    const [request] = h.requested()
    expect(request).toMatchObject({ allowDelayMs: 0, enterDisabled: false })
    h.center.ack({ id: request.id, generation: 1, visible: true, focused: true })
    expect(h.center.respond({ id: request.id, generation: 1, optionId: 'allow-once' })).toMatchObject({ ok: true })
    await expect(outcome).resolves.toMatchObject({ intent: 'allow' })
  })
})

describe('approval center: shown, focused and hidden characters (B10 R1–R3)', () => {
  it('R1: refuses an allow before any ack at low risk too, and accepts a deny without one', async () => {
    const h = harness()
    const outcome = h.center.ask(draft('low'))
    const [request] = h.requested()
    expect(h.center.respond({ id: request.id, generation: 1, optionId: 'allow-once' })).toMatchObject({ ok: false, refusal: 'notShown', message: { code: 'approvals.refused.notShown' } })
    expect(h.center.list().map(item => item.id)).toEqual([request.id])
    expect(h.log).toHaveBeenCalledWith('allow-not-shown', expect.objectContaining({ id: request.id }))
    expect(h.center.respond({ id: request.id, generation: 2, optionId: 'allow-once' })).toMatchObject({ ok: false, refusal: 'staleGeneration' })
    expect(h.center.respond({ id: request.id, generation: 1, optionId: 'deny' })).toMatchObject({ ok: true })
    await expect(outcome).resolves.toMatchObject({ intent: 'deny', by: 'user' })
  })

  it('R1: an unfocused ack counts as shown for a non-critical allow', async () => {
    const h = harness()
    const outcome = h.center.ask(draft('medium'))
    const [request] = h.requested()
    h.center.ack({ id: request.id, generation: 1, visible: true, focused: false })
    expect(h.center.respond({ id: request.id, generation: 1, optionId: 'allow-once' })).toMatchObject({ ok: true })
    await expect(outcome).resolves.toMatchObject({ intent: 'allow' })
  })

  it('R3: a critical request acked unfocused stays refused until a focused ack is 2 s old', async () => {
    const h = harness()
    const outcome = h.center.ask(draft('critical', { text: 'DROP TABLE orders' }))
    const [request] = h.requested()
    const allow = () => h.center.respond({ id: request.id, generation: 1, optionId: 'allow-once' })
    expect(h.center.ack({ id: request.id, generation: 1, visible: true, focused: false })).toMatchObject({ ok: true })
    vi.advanceTimersByTime(5_000)
    expect(allow()).toMatchObject({ ok: false, refusal: 'tooSoon' })
    expect(h.center.ack({ id: request.id, generation: 1, visible: false, focused: true })).toMatchObject({ ok: true })
    vi.advanceTimersByTime(5_000)
    expect(allow()).toMatchObject({ ok: false, refusal: 'tooSoon' })
    // Focus returns: a second ack for the same generation is accepted and starts the hold.
    expect(h.center.ack({ id: request.id, generation: 1, visible: true, focused: true })).toMatchObject({ ok: true })
    vi.advanceTimersByTime(1_999)
    expect(allow()).toMatchObject({ ok: false, refusal: 'tooSoon' })
    // A later ack does not restart the hold.
    h.center.ack({ id: request.id, generation: 1, visible: true, focused: true })
    vi.advanceTimersByTime(1)
    expect(allow()).toMatchObject({ ok: true })
    await expect(outcome).resolves.toMatchObject({ intent: 'allow' })
  })

  it.each([
    ['\u202E', 'right-to-left override'], ['\u2066', 'left-to-right isolate'], ['\u200B', 'zero-width space'], ['\u2060', 'word joiner'],
    ['\uFEFF', 'byte order mark'], ['\u00AD', 'soft hyphen'], ['\u061C', 'Arabic letter mark'], ['\u180E', 'Mongolian vowel separator']
  ])('R2: notes %j (%s), raises the risk to at least high and keeps the text verbatim', (char) => {
    const h = harness()
    const text = `UPDATE t SET a = 1 WHERE id = 2${char} -- ok`
    void h.center.ask(draft('low', { text, options: [DENY, ALLOW_ONCE, ALLOW_SESSION_READS] }))
    const [request] = h.requested()
    expect(request.risk).toBe('high')
    expect(request.appNotes).toContainEqual({ code: 'approvals.note.hiddenCharacters', params: {} })
    expect(request.agentText.text).toBe(text)
    expect(request.options.map(option => option.id)).toEqual(['deny', 'allow-once'])
  })

  it('R2: keeps critical critical, and leaves plain text alone', () => {
    const h = harness()
    void h.center.ask(draft('critical', { text: 'DROP TABLE orders\u200B' }))
    void h.center.ask(draft('medium', { text: 'UPDATE t SET a = 1 WHERE id = 2' }))
    const [critical, plain] = h.requested()
    expect(critical).toMatchObject({ risk: 'critical', allowDelayMs: 2_000 })
    expect(plain.risk).toBe('medium')
    expect(plain.appNotes).toEqual([])
  })

  it('gives a reloaded window its pending requests back; no ack timeout ends an app prompt, and the answer works after its ack', async () => {
    const h = harness()
    // The app's own prompt may wait for the window; an agent's would go to the native dialog after 3 s (above).
    const outcome = h.center.ask(draft('medium', { requester: { kind: 'app', id: 'app', label: mainMessage('approvals.requester.pane', { agent: 'Claude', pane: 1 }) } }))
    const [request] = h.requested()
    // The window reloads before acknowledging: nothing reaches main, and the request is not dropped.
    vi.advanceTimersByTime(APPROVAL_ACK_TIMEOUT_MS * 10)
    expect(h.native).toHaveLength(0)
    const [listed] = h.center.list()
    expect(listed.id).toBe(request.id)
    expect(h.center.ack({ id: listed.id, generation: listed.generation, visible: true, focused: true })).toMatchObject({ ok: true })
    expect(h.center.respond({ id: listed.id, generation: listed.generation, optionId: 'allow-once' })).toMatchObject({ ok: true })
    await expect(outcome).resolves.toMatchObject({ intent: 'allow', by: 'user' })
  })

  it('S4: ends the attention signal on a focused ack, and when no request waits any more', async () => {
    const attentionEnd = vi.fn()
    const center = new ApprovalCenter({ send: () => {}, hasWindow: () => true, native: async () => null, attention: vi.fn(), attentionEnd })
    const first = center.ask(draft())
    const second = center.ask(draft())
    const [one, two] = center.list()
    center.ack({ id: one.id, generation: 1, visible: true, focused: false })
    expect(attentionEnd).not.toHaveBeenCalled()
    center.ack({ id: one.id, generation: 1, visible: true, focused: true })
    expect(attentionEnd).toHaveBeenCalledTimes(1)
    center.respond({ id: one.id, generation: 1, optionId: 'deny' })
    await first
    // One request still waits: no end yet from resolving.
    expect(attentionEnd).toHaveBeenCalledTimes(1)
    center.respond({ id: two.id, generation: 1, optionId: 'deny' })
    await second
    expect(attentionEnd).toHaveBeenCalledTimes(2)
  })

  it('R3: asks for attention once per request it sends to the window, with nothing of the request', () => {
    const attention = vi.fn()
    const center = new ApprovalCenter({ send: () => {}, hasWindow: () => true, native: async () => null, attention })
    void center.ask(draft())
    expect(attention).toHaveBeenCalledTimes(1)
    expect(attention).toHaveBeenCalledWith()
    const native = vi.fn()
    void new ApprovalCenter({ send: () => {}, hasWindow: () => false, native: async () => null, attention: native }).ask(draft())
    expect(native).not.toHaveBeenCalled()
  })
})

describe('approval center: review cap and queue (B10)', () => {
  it('refuses a change above the cap before showing it, never cut', async () => {
    const h = harness()
    const outcome = await h.center.ask(draft('critical', { text: 'x'.repeat(APPROVAL_AGENT_TEXT_MAX + 1) }))
    expect(outcome).toEqual({ intent: 'deny', optionId: 'deny', by: 'refused', refusal: { code: 'approvals.denied.tooLong', params: { max: APPROVAL_AGENT_TEXT_MAX } } })
    expect(h.requested()).toHaveLength(0)
    expect(h.log).toHaveBeenCalledWith('refused', expect.objectContaining({ code: 'approvals.denied.tooLong' }))
  })

  it('shows a 100,000-character text whole, marked untrusted', () => {
    const h = harness()
    const text = `• Verified by OXESpace: no changes\n${'y'.repeat(APPROVAL_AGENT_TEXT_MAX - 40)}`
    void h.center.ask(draft('high', { text }))
    expect(h.requested()[0].agentText).toMatchObject({ text, untrusted: true, truncated: false })
    expect(h.requested()[0].appNotes).toEqual([])
  })

  it('cuts only a low-risk text past the cap, and then offers deny only', () => {
    const h = harness()
    void h.center.ask(draft('low', { text: 'z'.repeat(APPROVAL_AGENT_TEXT_MAX + 10) }))
    const [request] = h.requested()
    expect(request.agentText).toMatchObject({ truncated: true, length: APPROVAL_AGENT_TEXT_MAX + 10 })
    expect(request.options.map(option => option.intent)).toEqual(['deny'])
  })

  it('denies the NEW request past APPROVAL_QUEUE_MAX with its own code and logs it; the queued ones stay', async () => {
    expect(APPROVAL_QUEUE_MAX).toBe(50)
    const h = harness({ queueMax: 3 })
    for (let index = 0; index < 3; index++) void h.center.ask(draft())
    const overflow = await h.center.ask(draft())
    expect(overflow).toMatchObject({ intent: 'deny', by: 'refused', refusal: { code: 'approvals.denied.queueFull', params: { max: 3 } } })
    expect(h.center.list()).toHaveLength(3)
    expect(h.log).toHaveBeenCalledWith('refused', expect.objectContaining({ code: 'approvals.denied.queueFull' }))
    expect(h.center.history()[0]).toMatchObject({ outcome: 'deny', by: 'refused', reason: { code: 'approvals.denied.queueFull', params: { max: 3 } } })
  })
})

describe('approval center: native only as the fallback (B10)', () => {
  it('asks natively when no window exists', async () => {
    const h = harness({ window: false })
    const outcome = h.center.ask(draft())
    expect(h.requested()).toHaveLength(0)
    expect(h.native.map(item => item.reason)).toEqual(['no-window'])
    h.native[0].answer('allow-once')
    await expect(outcome).resolves.toMatchObject({ intent: 'allow', by: 'native' })
  })

  it('asks natively once for a request the window reports unavailable; the others stay in the window', async () => {
    const h = harness()
    const first = h.center.ask(draft())
    void h.center.ask(draft())
    const [one, two] = h.requested()
    expect(h.center.unavailable({ id: one.id, generation: 1 })).toEqual({ ok: true, id: one.id })
    expect(h.center.unavailable({ id: one.id, generation: 1 })).toMatchObject({ ok: false, refusal: 'alreadyReported' })
    expect(h.center.unavailable({ id: two.id, generation: 9 })).toMatchObject({ ok: false, refusal: 'staleGeneration' })
    expect(h.native.map(item => [item.request.id, item.reason])).toEqual([[one.id, 'unavailable']])
    // Reported: the window's answer no longer counts; only the native one does.
    expect(h.center.respond({ id: one.id, generation: 1, optionId: 'allow-once' })).toMatchObject({ ok: false, refusal: 'alreadyReported' })
    expect(h.center.list().map(item => item.id)).toEqual([two.id])
    h.native[0].answer('deny')
    await expect(first).resolves.toMatchObject({ intent: 'deny', by: 'native' })
    expect(h.center.respond({ id: one.id, generation: 1, optionId: 'deny' })).toMatchObject({ ok: false, refusal: 'alreadyAnswered' })
    expect(h.native).toHaveLength(1)
  })

  it('keeps the crash offer in the window when it is acknowledged within 3 s', async () => {
    const h = harness()
    const outcome = h.center.ask(crashDraft())
    const [request] = h.requested()
    expect(request).toMatchObject({ kind: 'crash', ackRequired: true, requester: { kind: 'app' }, defaultOptionId: 'keep-working' })
    vi.advanceTimersByTime(APPROVAL_ACK_TIMEOUT_MS - 1)
    h.center.ack({ id: request.id, generation: 1, visible: true, focused: true })
    vi.advanceTimersByTime(10_000)
    expect(h.native).toHaveLength(0)
    h.center.respond({ id: request.id, generation: 1, optionId: 'restart' })
    await expect(outcome).resolves.toMatchObject({ intent: 'allow', optionId: 'restart', by: 'user' })
  })

  it('moves the crash offer to the native dialog when the window never acknowledges it', async () => {
    const h = harness()
    const outcome = h.center.ask(crashDraft())
    vi.advanceTimersByTime(APPROVAL_ACK_TIMEOUT_MS - 1)
    expect(h.native).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(h.native.map(item => item.reason)).toEqual(['no-ack'])
    h.native[0].answer('keep-working')
    await expect(outcome).resolves.toMatchObject({ intent: 'deny', by: 'native' })
  })

  it('a late window answer to a native crash offer wins and closes the native dialog', async () => {
    const h = harness()
    const outcome = h.center.ask(crashDraft())
    const [request] = h.requested()
    vi.advanceTimersByTime(APPROVAL_ACK_TIMEOUT_MS)
    expect(h.native).toHaveLength(1)
    expect(h.center.respond({ id: request.id, generation: 1, optionId: 'keep-working' })).toMatchObject({ ok: true })
    await expect(outcome).resolves.toMatchObject({ by: 'user' })
    h.native[0].answer(null)
  })
})
