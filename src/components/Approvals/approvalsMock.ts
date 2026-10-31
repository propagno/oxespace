import { allowTooSoon } from '../../../shared/approval-rules'
import { mainMessage } from '../../../shared/messages'
import {
  APPROVAL_SCHEMA_VERSION, APPROVAL_TIMEOUT_MS, type ApprovalAckInput, type ApprovalAnswerInput, type ApprovalCallResult, type ApprovalHistoryEntry, type ApprovalRefusal,
  type ApprovalRequest, type ApprovalResolved, type ApprovalResolvedBy, type ApprovalsApi
} from '../../../shared/types/approvals'
import { setApprovalsApi } from './approvalsApi'
import { byCreatedAt } from './approvalsRules'

/**
 * Stand-in for `window.oxe.approvals` in unit tests (jsdom has no preload); installApprovalsMock() puts it in place. It answers like main's E2E mock (electron/main/e2e/approvals-mock.ts) and never approves
 * anything by itself. Tests drive it through `window.__oxeApprovalsMock`, which exists only when this mock is in use;
 * the e2e specs use main's mock (OXESPACE_E2E_APPROVALS) instead.
 */
export interface ApprovalsMockHook {
  /** Adds a request; missing fields get safe defaults (deny is the default option). Returns its id. */
  request(partial?: MockRequestInput): string
  /** Settles a pending request without the person, as main does on a timeout, a cancel or the native fallback. */
  settle(id: string, by: Exclude<ApprovalResolvedBy, 'user'>): void
  /** Re-issues a pending request with a new generation, so an answer to the old one is stale. `silent` skips the event. */
  bump(id: string, options?: { silent?: boolean }): void
  /** The next respond is refused with this code, whatever it answers (to show a refusal the window cannot predict). */
  refuseNext(refusal: ApprovalRefusal): void
  /** Adds a history entry main settled without showing it (queue full, too long). */
  record(entry: ApprovalHistoryEntry & { reason?: { code: string; params: Record<string, unknown> } }): void
  readonly responses: ReadonlyArray<{ id: string; optionId: string; generation: number }>
  readonly acks: ReadonlyArray<ApprovalAckInput>
  readonly unavailable: ReadonlyArray<ApprovalAnswerInput>
  reset(): void
}

/** A request with its agent text given as a string, for brevity. */
export type MockRequestInput = Partial<Omit<ApprovalRequest, 'agentText'>> & { agentText?: string | ApprovalRequest['agentText'] }

declare global {
  interface Window { __oxeApprovalsMock?: ApprovalsMockHook }
}

let sequence = 0

export function mockRequest(partial: MockRequestInput = {}): ApprovalRequest {
  sequence += 1
  const now = Date.now()
  const { agentText, ...rest } = partial
  const text = typeof agentText === 'string' ? { text: agentText, untrusted: true as const, length: [...agentText].length, truncated: false } : agentText
  return {
    schemaVersion: APPROVAL_SCHEMA_VERSION,
    generation: 1,
    kind: 'action',
    requester: { kind: 'agent', id: 'pane:p1', label: mainMessage('approvals.requester.pane', { agent: 'Claude', pane: 1 }) },
    risk: 'low',
    title: mainMessage('approvals.title.agent', {}),
    summary: mainMessage('approvals.summary.mcpConfirm', { tool: 'oxespace_agents_change', action: 'prompt', target: 'C:\\repo' }),
    appNotes: [],
    options: [
      { id: 'deny', intent: 'deny', label: mainMessage('approvals.option.deny', {}) },
      { id: 'allow', intent: 'allow', label: mainMessage('approvals.option.allowOnce', {}) },
      { id: 'allow-session', intent: 'allow-session', label: mainMessage('approvals.option.allowSessionReads', {}) }
    ],
    defaultOptionId: 'deny',
    ackRequired: false,
    allowDelayMs: 0,
    enterDisabled: false,
    createdAt: now,
    expiresAt: now + APPROVAL_TIMEOUT_MS,
    ...rest,
    agentText: text ?? { text: '', untrusted: true, length: 0, truncated: false },
    id: partial.id ?? `mock-${sequence}`
  }
}

export function createApprovalsMock(): ApprovalsApi & { hook: ApprovalsMockHook } {
  const pending = new Map<string, ApprovalRequest>()
  let history: Array<ApprovalHistoryEntry & { reason?: { code: string; params: Record<string, unknown> } }> = []
  const reported = new Set<string>()
  const displayedAt = new Map<string, number>()
  let forced: ApprovalRefusal | null = null
  const requested = new Set<(request: ApprovalRequest) => void>()
  const resolved = new Set<(resolution: ApprovalResolved) => void>()
  const responses: Array<{ id: string; optionId: string; generation: number }> = []
  const acks: ApprovalAckInput[] = []
  const acked = new Set<string>()
  const unavailable: ApprovalAnswerInput[] = []

  const refuse = (refusal: ApprovalRefusal): ApprovalCallResult => ({ ok: false, refusal, message: mainMessage(`approvals.refused.${refusal}`, {}) })
  const current = (input: ApprovalAnswerInput): ApprovalRequest | ApprovalRefusal => {
    const request = pending.get(input.id)
    if (!request) return history.some(entry => entry.id === input.id) ? 'alreadyAnswered' : 'notPending'
    return input.generation === request.generation ? request : 'staleGeneration'
  }
  const settle = (request: ApprovalRequest, optionId: string, by: ApprovalResolvedBy): void => {
    const option = request.options.find(item => item.id === optionId) ?? request.options.find(item => item.id === request.defaultOptionId)!
    pending.delete(request.id)
    history = [{ id: request.id, kind: request.kind, requester: request.requester, risk: request.risk, title: request.title, summary: request.summary, outcome: option.intent, by, textSha256: '', createdAt: request.createdAt, resolvedAt: Date.now() }, ...history]
    for (const listener of resolved) listener({ id: request.id, generation: request.generation, outcome: option.intent, optionId: option.id, by })
  }

  const hook: ApprovalsMockHook = {
    request(partial) {
      const request = mockRequest(partial)
      pending.set(request.id, request)
      for (const listener of requested) listener(request)
      return request.id
    },
    settle(id, by) {
      const request = pending.get(id)
      if (request) settle(request, request.defaultOptionId, by)
    },
    bump(id, options) {
      const request = pending.get(id)
      if (!request) return
      const next = { ...request, generation: request.generation + 1 }
      pending.set(id, next)
      if (!options?.silent) for (const listener of requested) listener(next)
    },
    refuseNext(refusal) { forced = refusal },
    record(entry) { history = [entry, ...history] },
    responses,
    acks,
    unavailable,
    reset() {
      pending.clear(); history = []; reported.clear(); displayedAt.clear(); acked.clear(); forced = null; responses.length = 0; acks.length = 0; unavailable.length = 0
    }
  }

  return {
    hook,
    list: async () => [...pending.values()].sort(byCreatedAt),
    history: async () => [...history],
    async respond(input) {
      responses.push(input)
      if (forced) { const refusal = forced; forced = null; return refuse(refusal) }
      const request = current(input)
      if (typeof request === 'string') return refuse(request)
      const option = request.options.find(item => item.id === input.optionId)
      if (!option) return refuse('unknownOption')
      // As main (#238): an allow at any risk before any ack is refused notShown; one sooner than allowDelayMs after the
      // first visible and focused ack is refused tooSoon. The request stays either way.
      if (option.intent !== 'deny' && !acked.has(`${request.id}#${request.generation}`)) return refuse('notShown')
      if (allowTooSoon(request, option.intent, displayedAt.get(request.id), Date.now())) return refuse('tooSoon')
      settle(request, input.optionId, 'user')
      return { ok: true, id: request.id }
    },
    async ack(input) {
      acks.push(input)
      const request = current(input)
      if (typeof request === 'string') return refuse(request)
      acked.add(`${request.id}#${request.generation}`)
      // As main (#238): the hold starts at the first ack with visible and focused both exactly true; later acks keep it.
      if (input.visible === true && input.focused === true && !displayedAt.has(request.id)) displayedAt.set(request.id, Date.now())
      return { ok: true, id: request.id }
    },
    async unavailable(input) {
      unavailable.push(input)
      const request = current(input)
      if (typeof request === 'string') return refuse(request)
      const key = `${request.id}#${request.generation}`
      if (reported.has(key)) return refuse('alreadyReported')
      reported.add(key)
      return { ok: true, id: request.id }
    },
    onRequested(listener) { requested.add(listener); return () => { requested.delete(listener) } },
    onResolved(listener) { resolved.add(listener); return () => { resolved.delete(listener) } }
  }
}

/** Makes the mock the approvals channel and exposes its hook as `window.__oxeApprovalsMock` (tests). */
export function installApprovalsMock(): ApprovalsApi & { hook: ApprovalsMockHook } {
  const mock = createApprovalsMock()
  window.__oxeApprovalsMock = mock.hook
  setApprovalsApi(mock)
  return mock
}
