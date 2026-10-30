import type { ApprovalRequest, ApprovalsApi } from './approvalsContract'

/**
 * The part of in-app approvals that loads at boot, kept small: it listens for requests, loads the approval window's
 * code (at idle after the first paint, and at once when a request arrives) and holds the fail-safe. If that code
 * fails to load, or the window does not show a request within SHOW_TIMEOUT_MS, main is told the window cannot show
 * it (`approvals.unavailable`) and asks with its own dialog. That report is never an answer: nothing here approves or
 * denies on the person's behalf.
 */

/** Event the palette sends to open this session's approval decisions. */
export const OPEN_APPROVAL_HISTORY_EVENT = 'oxe:open-approval-history'
export const SHOW_TIMEOUT_MS = 3_000
export const PRELOAD_FALLBACK_MS = 2_000

export type CenterModule = typeof import('./ApprovalCenter')

let importer: () => Promise<CenterModule> = () => import('./ApprovalCenter')
let loading: Promise<CenterModule> | null = null
const timers = new Map<string, { generation: number; timer: ReturnType<typeof setTimeout> }>()
const shown = new Set<string>()
const handedOff = new Set<string>()
let historyWanted = false

/** Whether the history was asked for since the last call (it may have been asked before the window's code loaded). */
export function takeHistoryRequest(): boolean {
  const wanted = historyWanted
  historyWanted = false
  return wanted
}

/** The approval window's code, loaded once; a failed load is tried again on the next request. */
export function loadCenter(): Promise<CenterModule> {
  loading ??= importer().catch((error: unknown) => { loading = null; throw error })
  return loading
}

/** Loads the approval window's code when the renderer is idle, so the first request does not wait for a chunk. */
export function schedulePreload(): () => void {
  const run = (): void => { void loadCenter().catch(() => {}) }
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run)
    return () => window.cancelIdleCallback?.(handle)
  }
  const handle = setTimeout(run, PRELOAD_FALLBACK_MS)
  return () => clearTimeout(handle)
}

/** The window shows these requests (the dialog is mounted with them in its queue); their fail-safe stops. */
export function reportShown(ids: readonly string[]): void {
  for (const id of ids) {
    const watch = timers.get(id)
    if (watch) clearTimeout(watch.timer)
    timers.delete(id)
    shown.add(id)
  }
}

/** Requests handed back to main's own dialog; the window leaves them out of its queue. */
export function isHandedOff(id: string): boolean {
  return handedOff.has(id)
}

function handOff(api: ApprovalsApi, id: string, generation: number): void {
  const watch = timers.get(id)
  if (watch) clearTimeout(watch.timer)
  timers.delete(id)
  if (shown.has(id) || handedOff.has(id)) return
  handedOff.add(id)
  // TODO(CCR B10): `approvals.unavailable` is the coordinator's name for this report; align with the final channel.
  void api.unavailable({ id, generation }).catch(() => {})
}

function watch(api: ApprovalsApi, request: ApprovalRequest, timeoutMs: number): void {
  if (shown.has(request.id) || handedOff.has(request.id)) return
  const existing = timers.get(request.id)
  if (existing) { existing.generation = request.generation; return }
  const entry = { generation: request.generation, timer: setTimeout(() => handOff(api, request.id, entry.generation), timeoutMs) }
  timers.set(request.id, entry)
}

function settled(id: string): void {
  const entry = timers.get(id)
  if (entry) clearTimeout(entry.timer)
  timers.delete(id)
}

export interface StartOptions {
  api: ApprovalsApi
  /** Called with the approval window's code once it is loaded and there is something to show. */
  onReady: (module: CenterModule) => void
  timeoutMs?: number
}

/** Starts listening. Returns the cleanup. */
export function startApprovals({ api, onReady, timeoutMs = SHOW_TIMEOUT_MS }: StartOptions): () => void {
  let active = true
  const activate = (): void => {
    loadCenter().then(module => { if (active) onReady(module) }, () => {
      // The code is not there: every request waiting for it goes back to main at once.
      for (const [id, entry] of [...timers]) handOff(api, id, entry.generation)
    })
  }
  const offRequested = api.onRequested(request => { watch(api, request, timeoutMs); activate() })
  const offResolved = api.onResolved(resolution => settled(resolution.id))
  const openHistory = (): void => { historyWanted = true; activate() }
  window.addEventListener(OPEN_APPROVAL_HISTORY_EVENT, openHistory)
  // Requests that were already waiting (a reload while main held one).
  void api.list().then(requests => {
    if (!active || !requests.length) return
    for (const request of requests) watch(api, request, timeoutMs)
    activate()
  }, () => {})
  return () => {
    active = false
    offRequested(); offResolved()
    window.removeEventListener(OPEN_APPROVAL_HISTORY_EVENT, openHistory)
  }
}

/** Tests: replace the dynamic import and clear the module state. */
export function resetApprovalsBoot(nextImporter?: () => Promise<CenterModule>): void {
  for (const entry of timers.values()) clearTimeout(entry.timer)
  timers.clear(); shown.clear(); handedOff.clear(); historyWanted = false
  loading = null
  importer = nextImporter ?? (() => import('./ApprovalCenter'))
}
