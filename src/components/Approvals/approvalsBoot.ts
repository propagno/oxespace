import { APPROVAL_ACK_TIMEOUT_MS, type ApprovalRequest, type ApprovalsApi } from '../../../shared/types/approvals'

/**
 * The part of in-app approvals that loads at boot, kept small: it listens for requests, loads the approval window's
 * code (at idle after the first paint, and at once when a request arrives) and holds the fail-safe. If that code
 * fails to load, or the window does not show a request within SHOW_TIMEOUT_MS, main is told the window cannot show
 * it (`approvals.unavailable`) and asks with its own dialog. That report is never an answer: nothing here approves or
 * denies on the person's behalf. Requests with `ackRequired` (the crash prompt) are acknowledged when they are shown.
 */

/** Event the palette sends to open this session's approval decisions. */
export const OPEN_APPROVAL_HISTORY_EVENT = 'oxe:open-approval-history'
/** Same budget main gives an `ackRequired` request. */
export const SHOW_TIMEOUT_MS = APPROVAL_ACK_TIMEOUT_MS
export const PRELOAD_FALLBACK_MS = 2_000

export type CenterModule = typeof import('./ApprovalCenter')

let importer: () => Promise<CenterModule> = () => import('./ApprovalCenter')
let loading: Promise<CenterModule> | null = null
let api: ApprovalsApi | null = null
/** Keyed by `id#generation`: a request main re-issues is a new thing to show. */
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const shown = new Set<string>()
const handedOff = new Set<string>()
let historyWanted = false

const keyOf = (request: { id: string; generation: number }): string => `${request.id}#${request.generation}`

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

function stopTimer(key: string): void {
  const timer = timers.get(key)
  if (timer) clearTimeout(timer)
  timers.delete(key)
}

const acked = new Set<string>()

/**
 * The dialog is mounted with this queue (its count reads "1 of N"): the fail-safe of every request in it stops. The
 * first one is on screen; if main asked for an acknowledgement, it gets one, once per generation.
 */
export function reportShown(queue: readonly ApprovalRequest[], channel: ApprovalsApi | null = api): void {
  for (const request of queue) {
    const key = keyOf(request)
    if (handedOff.has(key)) continue
    stopTimer(key)
    shown.add(key)
  }
  const onScreen = queue[0]
  if (!onScreen?.ackRequired || !channel || handedOff.has(keyOf(onScreen)) || acked.has(keyOf(onScreen))) return
  acked.add(keyOf(onScreen))
  void channel.ack({ id: onScreen.id, generation: onScreen.generation }).catch(() => {})
}

/** Requests handed back to main's own dialog; the window leaves them out of its queue. */
export function isHandedOff(request: { id: string; generation: number }): boolean {
  return handedOff.has(keyOf(request))
}

function handOff(request: { id: string; generation: number }): void {
  const key = keyOf(request)
  stopTimer(key)
  if (!api || shown.has(key) || handedOff.has(key)) return
  handedOff.add(key)
  // A refusal (alreadyReported, staleGeneration, notPending) needs nothing more from the window.
  void api.unavailable({ id: request.id, generation: request.generation }).catch(() => {})
}

const waiting = new Map<string, ApprovalRequest>()

function watch(request: ApprovalRequest, timeoutMs: number): void {
  const key = keyOf(request)
  if (shown.has(key) || handedOff.has(key) || timers.has(key)) return
  waiting.set(key, request)
  timers.set(key, setTimeout(() => { waiting.delete(key); handOff(request) }, timeoutMs))
}

export interface StartOptions {
  api: ApprovalsApi
  /** Called once the approval window's code is loaded and there is something to show. */
  onReady: (module: CenterModule) => void
  timeoutMs?: number
}

/** Starts listening. Returns the cleanup. */
export function startApprovals({ api: channel, onReady, timeoutMs = SHOW_TIMEOUT_MS }: StartOptions): () => void {
  let active = true
  api = channel
  const activate = (): void => {
    loadCenter().then(module => { if (active) onReady(module) }, () => {
      // The code is not there: every request waiting for it goes back to main at once.
      for (const [key, request] of [...waiting]) { waiting.delete(key); handOff(request) }
    })
  }
  const offRequested = channel.onRequested(request => { watch(request, timeoutMs); activate() })
  const offResolved = channel.onResolved(resolution => { const key = keyOf(resolution); waiting.delete(key); stopTimer(key) })
  const openHistory = (): void => { historyWanted = true; activate() }
  window.addEventListener(OPEN_APPROVAL_HISTORY_EVENT, openHistory)
  // Requests that were already waiting (a reload while main held one).
  void channel.list().then(requests => {
    if (!active || !requests.length) return
    for (const request of requests) watch(request, timeoutMs)
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
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear(); shown.clear(); handedOff.clear(); waiting.clear(); acked.clear(); historyWanted = false
  loading = null
  api = null
  importer = nextImporter ?? (() => import('./ApprovalCenter'))
}
