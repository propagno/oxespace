import { ApprovalError, byCreatedAt, type ApprovalHistoryEntry, type ApprovalRequest, type ApprovalResolution, type ApprovalResolvedBy, type ApprovalsApi, type ApprovalUnavailableInput } from './approvalsContract'

/**
 * Stand-in for `window.oxe.approvals` while main does not expose it (TODO(CCR B10)). It keeps requests in memory, answers
 * like main would (stale generations and unknown options are refused) and never approves anything by itself. Tests and
 * e2e drive it through `window.__oxeApprovalsMock`, which exists only when this mock is the adapter in use.
 */
export interface ApprovalsMockHook {
  /** Adds a request; missing fields get safe defaults (deny is the default option). Returns its id. */
  request(partial?: Partial<ApprovalRequest>): string
  /** Settles a pending request without the person, as main does on a timeout or a cancel. */
  settle(id: string, by: Exclude<ApprovalResolvedBy, 'user'>): void
  /** Re-issues a pending request with a new generation, so an answer to the old one is stale. `silent` skips the event. */
  bump(id: string, options?: { silent?: boolean }): void
  /** What the window sent, for assertions. */
  readonly responses: ReadonlyArray<{ id: string; optionId: string; generation: number }>
  readonly unavailable: ReadonlyArray<ApprovalUnavailableInput>
  reset(): void
}

declare global {
  interface Window { __oxeApprovalsMock?: ApprovalsMockHook }
}

let sequence = 0

export function mockRequest(partial: Partial<ApprovalRequest> = {}): ApprovalRequest {
  sequence += 1
  const id = partial.id ?? `mock-${sequence}`
  return {
    generation: 1,
    kind: 'action',
    requester: { kind: 'agent', id: 'agent-1', label: 'Claude Code' },
    risk: 'medium',
    appNotes: [],
    agentText: '',
    truncated: false,
    agentTextLimit: 200_000,
    options: [
      { id: 'deny', intent: 'deny', label: { code: 'approvals.option.deny', params: {} } },
      { id: 'allow', intent: 'allow', label: { code: 'approvals.option.allowOnce', params: {} } },
      { id: 'allow-session', intent: 'allow-session', label: { code: 'approvals.option.allowSession', params: {} } }
    ],
    defaultOptionId: 'deny',
    createdAt: Date.now(),
    ...partial,
    id
  }
}

export function createApprovalsMock(): ApprovalsApi & { hook: ApprovalsMockHook } {
  const pending = new Map<string, ApprovalRequest>()
  let history: ApprovalHistoryEntry[] = []
  const requested = new Set<(request: ApprovalRequest) => void>()
  const resolved = new Set<(resolution: ApprovalResolution) => void>()
  const responses: Array<{ id: string; optionId: string; generation: number }> = []
  const unavailable: ApprovalUnavailableInput[] = []

  const settle = (request: ApprovalRequest, resolution: ApprovalResolution): void => {
    pending.delete(request.id)
    const at = resolution.at ?? Date.now()
    history = [...history, { id: request.id, kind: request.kind, requester: request.requester, risk: request.risk, environment: request.environment, outcome: resolution.outcome, by: resolution.by, at }]
    for (const listener of resolved) listener({ ...resolution, at })
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
      if (request) settle(request, { id, outcome: 'deny', by })
    },
    bump(id, options) {
      const request = pending.get(id)
      if (!request) return
      const next = { ...request, generation: request.generation + 1 }
      pending.set(id, next)
      if (!options?.silent) for (const listener of requested) listener(next)
    },
    responses,
    unavailable,
    reset() {
      pending.clear(); history = []; responses.length = 0; unavailable.length = 0
    }
  }

  return {
    hook,
    list: async () => [...pending.values()].sort(byCreatedAt),
    history: async () => [...history],
    async respond(input) {
      responses.push(input)
      const request = pending.get(input.id)
      if (!request) throw new ApprovalError('approvals.notFound')
      if (request.generation !== input.generation) throw new ApprovalError('approvals.stale')
      const option = request.options.find(item => item.id === input.optionId)
      if (!option) throw new ApprovalError('approvals.invalidOption')
      settle(request, { id: request.id, outcome: option.intent, by: 'user' })
    },
    async unavailable(input) {
      // Main would show its own dialog now; the mock only records the hand-off and forgets the request.
      unavailable.push(input)
      pending.delete(input.id)
    },
    onRequested(listener) { requested.add(listener); return () => { requested.delete(listener) } },
    onResolved(listener) { resolved.add(listener); return () => { resolved.delete(listener) } }
  }
}
