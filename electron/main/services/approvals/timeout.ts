import { APPROVAL_TIMEOUT_MS } from '../../../../shared/types/approvals'

/** The shortest lifetime the e2e override can give a request. */
export const APPROVAL_TIMEOUT_FLOOR_MS = 50

/**
 * How long a request waits before it is denied. `OXESPACE_E2E_APPROVALS_TIMEOUT_MS` shortens it for end-to-end runs of
 * an unpackaged build, so homologation can cover expiry (the real app, not the mock). It can only shorten: an expired
 * request is denied with its default, so a shorter wait never allows anything. Ignored in a packaged build, above
 * APPROVAL_TIMEOUT_MS, and floored at APPROVAL_TIMEOUT_FLOOR_MS.
 */
export function approvalTimeoutMs(env: Record<string, string | undefined>, isPackaged: boolean): number {
  if (isPackaged) return APPROVAL_TIMEOUT_MS
  const raw = env.OXESPACE_E2E_APPROVALS_TIMEOUT_MS?.trim()
  if (!raw) return APPROVAL_TIMEOUT_MS
  const value = Number(raw)
  if (!Number.isFinite(value)) return APPROVAL_TIMEOUT_MS
  return Math.min(APPROVAL_TIMEOUT_MS, Math.max(APPROVAL_TIMEOUT_FLOOR_MS, Math.floor(value)))
}
