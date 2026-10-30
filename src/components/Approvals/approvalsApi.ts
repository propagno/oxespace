import { errorText } from '../../utils/humanizeError'
import { APPROVAL_REFUSALS, ApprovalError, type ApprovalRefusal, type ApprovalsApi } from './approvalsContract'
import { createApprovalsMock } from './approvalsMock'

const METHODS = ['list', 'respond', 'history', 'unavailable', 'onRequested', 'onResolved'] as const

/** `window.oxe.approvals` when main exposes the whole B10 surface, else null. TODO(CCR B10): typed once it is in OxeApi. */
export function realApprovalsApi(): ApprovalsApi | null {
  const candidate = typeof window === 'undefined' ? undefined : (window.oxe as unknown as { approvals?: Partial<ApprovalsApi> } | undefined)?.approvals
  return candidate && METHODS.every(name => typeof candidate[name] === 'function') ? candidate as ApprovalsApi : null
}

let current: ApprovalsApi | null = null

/**
 * The approvals channel: main's when it exists, otherwise the in-window mock (TODO(CCR B10): remove the mock branch
 * once every build ships the channel). The mock's test hook is installed only on that branch.
 */
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

/**
 * The C3 code of a refused answer. Over IPC the code arrives in the error's `code` or inside Electron's
 * "Error invoking remote method" text. TODO(CCR B10): align with how main serialises the refusal.
 */
export function refusalOf(cause: unknown): ApprovalRefusal | null {
  const code = cause && typeof cause === 'object' ? (cause as { code?: unknown }).code : undefined
  if (typeof code === 'string' && (APPROVAL_REFUSALS as readonly string[]).includes(code)) return code as ApprovalRefusal
  const text = errorText(cause)
  return APPROVAL_REFUSALS.find(refusal => text.includes(refusal)) ?? null
}

export { ApprovalError }
