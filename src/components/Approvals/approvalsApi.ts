import type { ApprovalsApi } from '../../../shared/types/approvals'

const METHODS = ['list', 'respond', 'ack', 'unavailable', 'history', 'onRequested', 'onResolved'] as const

/** `window.oxe.approvals` (B10) when the preload exposes the whole surface, else null. */
export function realApprovalsApi(): ApprovalsApi | null {
  const candidate = typeof window === 'undefined' ? undefined : (window.oxe as { approvals?: Partial<ApprovalsApi> } | undefined)?.approvals
  return candidate && METHODS.every(name => typeof candidate[name] === 'function') ? candidate as ApprovalsApi : null
}

/**
 * A channel that never asks: what a window without the preload (a plain browser tab) listens to. Nothing can be
 * requested through it, so nothing can be answered either.
 */
const silent: ApprovalsApi = {
  list: async () => [],
  history: async () => [],
  respond: async () => ({ ok: false, refusal: 'notPending', message: { code: 'approvals.refused.notPending', params: {} } }),
  ack: async () => ({ ok: false, refusal: 'notPending', message: { code: 'approvals.refused.notPending', params: {} } }),
  unavailable: async () => ({ ok: false, refusal: 'notPending', message: { code: 'approvals.refused.notPending', params: {} } }),
  onRequested: () => () => {},
  onResolved: () => () => {}
}

let current: ApprovalsApi | null = null

/**
 * The approvals channel: main's through the preload. Tests put the in-window mock in its place with
 * installApprovalsMock() (approvalsMock.ts), which is never part of the boot bundle.
 */
export function approvalsApi(): ApprovalsApi {
  current ??= realApprovalsApi() ?? silent
  return current
}

/** Replaces the channel (the mock, in tests); null goes back to choosing on the next call. */
export function setApprovalsApi(api: ApprovalsApi | null): void {
  current = api
}

/** Forgets the chosen channel and the mock's hook (tests). */
export function resetApprovalsApi(): void {
  current = null
  if (typeof window !== 'undefined') delete window.__oxeApprovalsMock
}
