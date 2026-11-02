import type { ApprovalsApi } from '../../../shared/types/approvals'

/** `window.oxe.approvals` (B10, electron/preload/api.ts) when the preload exposes it, else null. */
export function realApprovalsApi(): ApprovalsApi | null {
  const candidate = window.oxe?.approvals
  return candidate?.onRequested ? candidate : null
}

let current: ApprovalsApi | null = null

/**
 * The approvals channel: main's through the preload, or null in a window without it (a plain browser tab), which then
 * listens to nothing. Tests put the in-window mock in its place with installApprovalsMock() (approvalsMock.ts), which
 * is never part of the boot bundle.
 */
export function approvalsApi(): ApprovalsApi | null {
  current ??= realApprovalsApi()
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
