import type { ApprovalAckInput, ApprovalRequest, ApprovalsApi } from '../../../shared/types/approvals'

/**
 * The part of in-app approvals that loads at boot, kept small: it listens for requests, loads the approval window's
 * code (at idle after the first paint, and at once when a request arrives) and holds the fail-safe. If that code
 * fails to load, or the window does not show a request within SHOW_TIMEOUT_MS, main is told the window cannot show
 * it (`approvals.unavailable`) and asks with its own dialog. That report is never an answer: nothing here approves or
 * denies on the person's behalf. If the window crashes after it mounted, everything it held goes back the same way.
 */

/** Event the palette sends to open this session's approval decisions. */
export const OPEN_APPROVAL_HISTORY_EVENT = 'oxe:open-approval-history'
/**
 * Same budget main gives an `ackRequired` request (APPROVAL_ACK_TIMEOUT_MS; a test keeps them equal). A literal, so the
 * boot bundle does not carry the contract's other constants.
 */
export const SHOW_TIMEOUT_MS = 3_000
export const PRELOAD_FALLBACK_MS = 2_000

export type CenterModule = typeof import('./ApprovalCenter')

let importer: () => Promise<CenterModule> = () => import('./ApprovalCenter')
let loading: Promise<CenterModule> | null = null
let api: ApprovalsApi | null = null
/** Requests waiting to be shown, with their fail-safe timer; keyed by `id#generation` (a re-issued request is new). */
const waiting = new Map<string, { request: ApprovalRequest; timer: ReturnType<typeof setTimeout> }>()
const shown = new Set<string>()
const handedOff = new Set<string>()
let historyWanted = false

const noop = (): void => {}
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
  const run = (): void => { void loadCenter().catch(noop) }
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run)
    return () => cancelIdleCallback(handle)
  }
  const handle = setTimeout(run, PRELOAD_FALLBACK_MS)
  return () => clearTimeout(handle)
}

function stopTimer(key: string): void {
  clearTimeout(waiting.get(key)?.timer)
  waiting.delete(key)
}

/** The last attention each request was acknowledged with (`id#generation` → visible && focused). */
const acked = new Map<string, boolean>()
/** The queue the dialog was last mounted with: what the crash fallback hands back. */
let mounted: readonly ApprovalRequest[] = []
/** The approval window crashed: every request from now on goes to main's own dialog at once. */
let crashed = false

/**
 * The dialog is mounted with this queue (its count reads "1 of N"): the fail-safe of every request in it stops. Each
 * request acknowledges itself when it is on screen (acknowledge, from the dialog).
 */
export function reportShown(queue: readonly ApprovalRequest[]): void {
  mounted = queue
  for (const request of queue) {
    const key = keyOf(request)
    if (handedOff.has(key)) continue
    stopTimer(key)
    shown.add(key)
    // B10: the window acks every request it holds, not only the one on screen; one queued behind it ("2 of N") is held
    // but not visible, so its ack says so and never starts the critical hold. Without it main's no-ack timer sends it to
    // the native dialog as well (HML on #243: 48 of 50 asked twice). The dialog acks it again once it is on screen.
    if (!acked.has(key)) acknowledge(request, { visible: false, focused: false })
  }
}

/**
 * The request on screen tells main it is displayed (`approvals.ack`, B10): once when it appears, and again each time
 * the window becomes visible and focused or stops being so (#238: any ack makes it shown; main's critical hold starts
 * at the first ack that is visible and focused; it flashes the window when it is not). Repeats with the same
 * attention are not sent.
 */
export function acknowledge(request: { id: string; generation: number }, attention: { visible: boolean; focused: boolean }, channel: ApprovalsApi | null = api): void {
  const key = keyOf(request)
  const looking = attention.visible && attention.focused
  if (!channel || handedOff.has(key) || acked.get(key) === looking) return
  acked.set(key, looking)
  const input: ApprovalAckInput = { id: request.id, generation: request.generation, visible: attention.visible, focused: attention.focused }
  // A refused ack (stale, no longer pending) needs nothing from the window; main logs it.
  void channel.ack(input).catch(noop)
}

/** The approval window holds this queue (on screen or behind its history): what a crash hands back. */
export function trackQueue(queue: readonly ApprovalRequest[]): void {
  mounted = queue
}

/**
 * The approval window crashed after it mounted: every request it held, and every one still waiting for it, goes back
 * to main's own dialog (`approvals.unavailable`), once each. Never an answer.
 */
export function handBackAll(): void {
  crashed = true
  const requests = [...mounted, ...[...waiting.values()].map(entry => entry.request)]
  for (const request of requests) handOff(request, true)
}

/** Requests handed back to main's own dialog; the window leaves them out of its queue. */
export function isHandedOff(request: { id: string; generation: number }): boolean {
  return handedOff.has(keyOf(request))
}

/** `evenShown`: the window showed it and then crashed; otherwise a request on screen is never handed off. */
function handOff(request: { id: string; generation: number }, evenShown = false): void {
  const key = keyOf(request)
  stopTimer(key)
  if (!api || (shown.has(key) && !evenShown) || handedOff.has(key)) return
  handedOff.add(key)
  // A refusal (alreadyReported, staleGeneration, notPending) needs nothing more from the window.
  void api.unavailable({ id: request.id, generation: request.generation }).catch(noop)
}

function watch(request: ApprovalRequest, timeoutMs: number): void {
  const key = keyOf(request)
  if (shown.has(key) || handedOff.has(key) || waiting.has(key)) return
  if (crashed) { handOff(request); return }
  waiting.set(key, { request, timer: setTimeout(() => handOff(request), timeoutMs) })
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
      for (const { request } of [...waiting.values()]) handOff(request)
    })
  }
  const offRequested = channel.onRequested(request => { watch(request, timeoutMs); activate() })
  const offResolved = channel.onResolved(resolution => {
    stopTimer(keyOf(resolution))
    mounted = mounted.filter(request => keyOf(request) !== keyOf(resolution))
  })
  const openHistory = (): void => { historyWanted = true; activate() }
  window.addEventListener(OPEN_APPROVAL_HISTORY_EVENT, openHistory)
  // Requests that were already waiting (a reload while main held one).
  void channel.list().then(requests => {
    if (!active || !requests.length) return
    for (const request of requests) watch(request, timeoutMs)
    activate()
  }, noop)
  return () => {
    active = false
    offRequested(); offResolved()
    window.removeEventListener(OPEN_APPROVAL_HISTORY_EVENT, openHistory)
  }
}

/** Tests: replace the dynamic import and clear the module state. */
export function resetApprovalsBoot(nextImporter?: () => Promise<CenterModule>): void {
  for (const { timer } of waiting.values()) clearTimeout(timer)
  shown.clear(); handedOff.clear(); waiting.clear(); acked.clear(); historyWanted = false
  mounted = []; crashed = false
  loading = null
  api = null
  importer = nextImporter ?? (() => import('./ApprovalCenter'))
}
