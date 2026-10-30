import { describe, expect, it, vi } from 'vitest'
import { createOxeApi, type PreloadIpc } from '../electron/preload/api'
import { FORBIDDEN_CAPABILITIES, FORBIDDEN_NAME, MCP_COVERAGE } from '../shared/mcp-coverage'
import { isMessageCode } from '../shared/messages'
import {
  APPROVAL_ACK_TIMEOUT_MS, APPROVAL_HISTORY_MAX, APPROVAL_INTENTS, APPROVAL_KINDS, APPROVAL_QUEUE_MAX, APPROVAL_REFUSALS, APPROVAL_RISKS, APPROVAL_TIMEOUT_MS, NOTIFY_PER_MINUTE
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
    expect(APPROVAL_REFUSALS).toEqual(['notPending', 'staleGeneration', 'alreadyAnswered', 'unknownOption', 'alreadyReported'])
  })

  it('fixes the limits', () => {
    expect(APPROVAL_TIMEOUT_MS).toBe(300_000)
    expect(APPROVAL_ACK_TIMEOUT_MS).toBe(3_000)
    expect(APPROVAL_QUEUE_MAX).toBe(50)
    expect(APPROVAL_HISTORY_MAX).toBe(200)
    expect(NOTIFY_PER_MINUTE).toBe(6)
  })

  it('has a C3 code for every title, the unavailable report, expiry and the notify refusals', () => {
    for (const code of ['approvals.title.agent', 'approvals.title.oxequery', 'approvals.title.previewAutomation', 'approvals.title.crash', 'approvals.unavailable', 'approvals.expired',
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
    await approvals.ack(answer)
    await approvals.unavailable(answer)
    await approvals.history()
    expect(vi.mocked(ipc.invoke).mock.calls).toEqual([
      [IPC_CHANNELS.approvals.list], [IPC_CHANNELS.approvals.respond, { ...answer, optionId: 'deny' }], [IPC_CHANNELS.approvals.ack, answer],
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
 * Acceptance regressions from the redesign audit (PR #228, P1-0..P1-3, P1-7). They need the implementation and turn
 * into real tests in the B10 impl PR; the main-process routing ones live in tests/integration/approvals-routing.test.ts.
 */
describe('B10 impl · acceptance (pending)', () => {
  it.todo('B10 impl: an OxeQuery db_execute with a 100,000-character statement reaches the window whole, as untrusted agentText, or is refused; never shown without its text')
  it.todo('B10 impl: a statement longer than APPROVAL_AGENT_TEXT_MAX arrives truncated with deny as the only option')
  it.todo('B10 impl: fake bullets and markdown ("• Verified by OXESpace", "## OXESpace") stay inside agentText; appNotes carry only C3 codes the app chose')
  it.todo('B10 impl: "/* … */ DROP TABLE" and a "--" line comment before DROP reach the window with risk critical and approvals.note.sql.removes')
  it.todo('B10 impl: oxespace_agents_change start with name "OXESpace" (or a confusable) is refused with agents.name.reserved')
  it.todo('B10 impl: a pane the person named "OXESpace" still shows the requester as approvals.requester.pane (provider and position), never the pane name')
  it.todo('B10 impl: an agent notify is shown with the notify.prefix.* prefix the app assigns')
  it.todo('B10 impl: an agent notify whose title or body contains a reserved name is refused with notify.refused.reservedName')
  it.todo('B10 impl: the NOTIFY_PER_MINUTE + 1th notify of an execution within a minute is refused with notify.refused.rateLimit')
  it.todo('B10 impl: respond twice → the second is refused alreadyAnswered; a stale generation → staleGeneration; an option not offered → unknownOption')
  it.todo('B10 impl: respond, ack and unavailable from a subframe or a webview are refused before any state changes')
  it.todo('B10 impl: an unanswered request resolves after APPROVAL_TIMEOUT_MS as deny, by "timeout", and onResolved tells the window')
  it.todo('B10 impl: a request answered in the native fallback or cancelled by its source sends onResolved, so the modal closes')
  it.todo('B10 impl: past APPROVAL_QUEUE_MAX pending requests a new one is denied without being shown')
  it.todo('B10 impl: every emitted request passes approvalRequestProblems() (deny default, no allow for a cut text)')
  it.todo('B10 impl: the catalog has a C3 summary for every confirm-level MCP action that has a natural sentence, or it falls back to approvals.summary.mcpConfirm')
})
