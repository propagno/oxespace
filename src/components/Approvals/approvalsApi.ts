import type { ApprovalsApi } from '../../../shared/types/approvals'
import { createApprovalsMock } from './approvalsMock'

const METHODS = ['list', 'respond', 'ack', 'unavailable', 'history', 'onRequested', 'onResolved'] as const

/** `window.oxe.approvals` (B10) when the preload exposes the whole surface, else null. */
export function realApprovalsApi(): ApprovalsApi | null {
  const candidate = typeof window === 'undefined' ? undefined : (window.oxe as { approvals?: Partial<ApprovalsApi> } | undefined)?.approvals
  return candidate && METHODS.every(name => typeof candidate[name] === 'function') ? candidate as ApprovalsApi : null
}

let current: ApprovalsApi | null = null

/** The approvals channel: main's, or the in-window mock when there is no preload (tests). The mock's hook exists only then. */
export function approvalsApi(): ApprovalsApi {
  if (current) return current
  const real = realApprovalsApi()
  if (real) return (current = real)
  const mock = createApprovalsMock()
  window.__oxeApprovalsMock = mock.hook
  return (current = mock)
}

/** Forgets the chosen adapter (tests). */
export function resetApprovalsApi(): void {
  current = null
  delete window.__oxeApprovalsMock
}
