import { describe, expect, it, vi } from 'vitest'
import { createOxeApi, type PreloadIpc } from '../electron/preload/api'
import { FORBIDDEN_CAPABILITIES, FORBIDDEN_NAME, MCP_COVERAGE } from '../shared/mcp-coverage'
import { isMessageCode } from '../shared/messages'
import {
  APPROVAL_ACK_TIMEOUT_MS, APPROVAL_CRITICAL_ALLOW_DELAY_MS, APPROVAL_HISTORY_MAX, APPROVAL_INTENTS, APPROVAL_KINDS, APPROVAL_QUEUE_MAX, APPROVAL_REFUSALS, APPROVAL_RISKS, APPROVAL_TIMEOUT_MS, NOTIFY_PER_MINUTE
} from '../shared/types/approvals'
import { IPC_CHANNELS } from '../shared/types/ipc'

describe('approvals contract (B10)', () => {
  it('uses stable channel names', () => {
    expect(IPC_CHANNELS.approvals).toEqual({
      list: 'approvals:list', respond: 'approvals:respond', ack: 'approvals:ack', unavailable: 'approvals:unavailable', history: 'approvals:history',
      onRequested: 'approvals:requested', onResolved: 'approvals:resolved'
    })
  })

  it('fixes the kinds, risks, intents and refusals', () => {
    expect(APPROVAL_KINDS).toEqual(['action', 'mcp-confirm', 'oxequery', 'preview-automation', 'crash'])
    expect(APPROVAL_RISKS).toEqual(['low', 'medium', 'high', 'critical'])
    expect(APPROVAL_INTENTS).toEqual(['deny', 'allow', 'allow-session'])
    expect(APPROVAL_REFUSALS).toEqual(['notPending', 'staleGeneration', 'alreadyAnswered', 'unknownOption', 'alreadyReported', 'tooSoon', 'notShown'])
  })

  it('fixes the limits', () => {
    expect(APPROVAL_TIMEOUT_MS).toBe(300_000)
    expect(APPROVAL_ACK_TIMEOUT_MS).toBe(3_000)
    expect(APPROVAL_QUEUE_MAX).toBe(50)
    expect(APPROVAL_CRITICAL_ALLOW_DELAY_MS).toBe(2_000)
    expect(APPROVAL_HISTORY_MAX).toBe(200)
    expect(NOTIFY_PER_MINUTE).toBe(6)
  })

  it('has a C3 code for every title, the unavailable report, expiry and the notify refusals', () => {
    for (const code of ['approvals.title.agent', 'approvals.title.oxequery', 'approvals.title.previewAutomation', 'approvals.title.crash', 'approvals.unavailable', 'approvals.expired', 'approvals.denied.queueFull', 'approvals.denied.tooLong', 'approvals.refused.tooSoon',
      'notify.prefix.pane', 'notify.prefix.conversation', 'notify.refused.reservedName', 'notify.refused.rateLimit', 'agents.name.reserved']) expect(isMessageCode(code), code).toBe(true)
  })

  it('keeps every window → main call with the person: forbidden to MCP', () => {
    expect(FORBIDDEN_CAPABILITIES).toContain('approvals.admin')
    const admin = MCP_COVERAGE['approvals.admin']
    expect('forbidden' in admin && !('tools' in admin)).toBe(true)
    expect(admin.ipc).toEqual(['approvals.list', 'approvals.respond', 'approvals.ack', 'approvals.unavailable', 'approvals.history'])
    // A tool for it could not even be named: every approval-like name is refused by the manifest test.
    expect(FORBIDDEN_NAME.test('oxespace_approvals')).toBe(true)
  })

  it('exposes each channel through the preload, and nothing else', async () => {
    const ipc: PreloadIpc = { invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), removeListener: vi.fn() }
    const approvals = createOxeApi(ipc).approvals!
    const answer = { id: 'r1', generation: 2 }
    await approvals.list()
    await approvals.respond({ ...answer, optionId: 'deny' })
    await approvals.ack({ ...answer, visible: true, focused: false })
    await approvals.unavailable(answer)
    await approvals.history()
    expect(vi.mocked(ipc.invoke).mock.calls).toEqual([
      [IPC_CHANNELS.approvals.list], [IPC_CHANNELS.approvals.respond, { ...answer, optionId: 'deny' }], [IPC_CHANNELS.approvals.ack, { ...answer, visible: true, focused: false }],
      [IPC_CHANNELS.approvals.unavailable, answer], [IPC_CHANNELS.approvals.history]
    ])
    const off = approvals.onRequested(vi.fn())
    approvals.onResolved(vi.fn())
    expect(ipc.on).toHaveBeenCalledWith(IPC_CHANNELS.approvals.onRequested, expect.any(Function))
    expect(ipc.on).toHaveBeenCalledWith(IPC_CHANNELS.approvals.onResolved, expect.any(Function))
    off()
    expect(ipc.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.approvals.onRequested, expect.any(Function))
    expect(Object.keys(approvals).sort()).toEqual(['ack', 'history', 'list', 'onRequested', 'onResolved', 'respond', 'unavailable'])
  })
})

/**
 * The acceptance regressions from the redesign audit (PR #228, P1-0..P1-3, P1-7) run for real since the B10 impl:
 *
 *   100,000-character text whole and untrusted; a change above the cap refused; a low one cut, deny only
 *                                      tests/approval-center.test.ts, tests/integration/oxequery-agent.test.ts
 *   fake bullets and markdown stay in agentText; appNotes are app codes only
 *                                      tests/approval-center.test.ts, tests/integration/oxequery-agent.test.ts
 *   hidden DROP (block or line comment) graded critical, with the app's note; DO/CALL high
 *                                      tests/integration/oxequery-agent.test.ts, tests/unit/sql-approval.test.ts
 *   "OXESpace" (and confusables) refused as a pane name; requester named by the app, not the pane
 *                                      tests/integration/mcp-agent-tools.test.ts, tests/approvals-impl.test.ts
 *   notify prefix, reserved names, rate limit
 *                                      tests/approvals-impl.test.ts, tests/integration/mcp-app-manage-tools.test.ts
 *   one answer per request and generation, tooSoon at critical, timeout, cancel, queue overflow, invariants
 *                                      tests/approval-center.test.ts
 *   main frame only                    tests/approvals-impl.test.ts
 *   no showMessageBox while a window exists; native fallback; crash handshake; unavailable once
 *                                      tests/integration/approvals-routing.test.ts
 */
