import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppView } from '../keyboard/keybindings'
import { announceFocus } from '../keyboard/terminalFocusActions'
import type { Chunk } from '../lib/chunk'

/**
 * Switching views (docs/design/motion.md, "Switching views and loading"; F7.2):
 * 1. the mode button is selected and busy at once: that is the first feedback;
 * 2. the current view stays on screen, untouched, while the next view's chunk loads, and the next view replaces it in
 *    one commit; with the chunk already there it renders without suspending, so React's fallback hold (~300 ms) is
 *    never paid;
 * 3. past 300 ms the view commits anyway and shows its own skeleton;
 * 4. a view's chunk starts loading on intent (hover or focus of its button, its shortcut);
 * 5. focus moves into the new view and its name is announced at the commit, not at the click.
 */
export const SKELETON_AFTER_MS = 300
export const VIEW_NAMES: Record<AppView, string> = { code: 'OxeCode', thread: 'OxeChat', data: 'OxeQuery', pods: 'OxePod', post: 'OxePost' }

/** The chunks the lazy views load from; OxeCode is in the entry. Read lazily so this module stays out of their way. */
let viewChunks: Partial<Record<AppView, Chunk<unknown>>> | null = null
async function chunkOf(view: AppView): Promise<Chunk<unknown> | undefined> {
  if (view === 'code') return undefined
  viewChunks ??= (await import('../components/Navigation/ModeViews')).VIEW_CHUNKS
  return viewChunks[view]
}
/** The chunk when it is already known and loaded, so a warm switch commits in the same task as the click. */
function readyNow(view: AppView): boolean {
  if (view === 'code') return true
  return Boolean(viewChunks?.[view]?.get())
}

/** Starts loading a view's chunk (hover, focus); a failure is left for the switch itself to show. */
export function prefetchView(view: AppView): void {
  void chunkOf(view).then(chunk => chunk?.load()).catch(() => undefined)
}

/** How long focus and the announcement wait for a slow view's content before moving anyway. */
export const ARRIVE_CAP_MS = 5000
/** The view's work area is still its skeleton (ViewSkeleton), not its content. */
const stillLoading = (host: Element): boolean => host.querySelector('[data-view-skeleton]') !== null

/**
 * Focus goes to the new view's first region, and its name is said once. Focus that is already somewhere on purpose stays:
 * in a dialog the switch opened (OxePod's "Connect in OxeQuery" opens New connection on its Password field) or already
 * inside the new view.
 */
function arrive(view: AppView): void {
  const host = document.querySelector<HTMLElement>(`[data-view="${view}"]`)
  const region = host?.querySelector<HTMLElement>('[data-focus-region], [role="region"], main, section') ?? host
  const active = document.activeElement
  const placed = active instanceof HTMLElement && active !== document.body && (active.closest('[role="dialog"], [role="alertdialog"]') !== null || host?.contains(active) === true)
  if (region && !placed) {
    if (!region.hasAttribute('tabindex') && !region.matches('button, a, input, textarea, select')) region.setAttribute('tabindex', '-1')
    region.focus({ preventScroll: true })
  }
  announceFocus(VIEW_NAMES[view])
}

export interface ViewSwitch {
  /** The view being switched to, while its chunk loads; the mode button shows it selected and busy. */
  pending: AppView | null
  select: (view: AppView) => void
}

/**
 * `commit` makes `view` the application view (it may do more, such as mounting OxeChat's host). The latest choice
 * wins: switching again while a view loads replaces the pending one.
 */
export function useViewSwitch(current: AppView, commit: (view: AppView) => void): ViewSwitch {
  const [pending, setPending] = useState<AppView | null>(null)
  const target = useRef<AppView | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const arrived = useRef<AppView | null>(null)
  const latestCommit = useRef(commit)
  useEffect(() => { latestCommit.current = commit })

  const finish = useCallback((view: AppView): void => {
    if (target.current !== view) return
    clearTimeout(timer.current)
    target.current = null
    arrived.current = view
    setPending(null)
    latestCommit.current(view)
  }, [])

  const select = useCallback((view: AppView): void => {
    if (view === current && target.current === null) return
    clearTimeout(timer.current)
    if (view === current) { target.current = null; setPending(null); return }
    target.current = view
    if (readyNow(view)) { finish(view); return }
    setPending(view)
    timer.current = setTimeout(() => finish(view), SKELETON_AFTER_MS)
    // A failed load commits too: the view's error boundary says what went wrong, with Try again.
    void chunkOf(view).then(chunk => chunk?.load()).then(() => finish(view), () => finish(view))
  }, [current, finish])

  // After the commit has painted: focus and announcement, for switches made here (not on start). On the slow path the
  // view committed with its skeleton: they wait for the content (the skeleton's status is the one announcement until
  // then), at most ARRIVE_CAP_MS.
  useEffect(() => {
    if (arrived.current !== current) return
    arrived.current = null
    const view = current
    let observer: MutationObserver | undefined
    let cap: ReturnType<typeof setTimeout> | undefined
    const done = (): void => { observer?.disconnect(); clearTimeout(cap); arrive(view) }
    const frame = requestAnimationFrame(() => {
      const host = document.querySelector(`[data-view="${view}"]`)
      if (!host || !stillLoading(host)) { done(); return }
      observer = new MutationObserver(() => { if (!stillLoading(host)) done() })
      observer.observe(host, { childList: true, subtree: true })
      cap = setTimeout(done, ARRIVE_CAP_MS)
    })
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); clearTimeout(cap) }
  }, [current])

  useEffect(() => () => clearTimeout(timer.current), [])
  return { pending, select }
}
