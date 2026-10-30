import type { TerminalPresence } from '../../../shared/types/ipc/terminal'
import type { WorkspacePane } from '../../../shared/types/workspace'

/** What the window knows about one pane's view, from the DOM and the app state. */
export interface PanePresenceInput {
  /** Its workspace host is hidden: a background workspace, or Thread/OxeQuery is showing. */
  hostHidden: boolean
  /** The view has a box inside the viewport (not under `display: none`, not scrolled away). */
  onScreen: boolean
  /** Another pane of the same workspace is maximized over it. */
  suppressed: boolean
  /** The active pane of its workspace. */
  active: boolean
  /** The keyboard focus is inside the view (covers views outside the grid, like the GitHub panel's). */
  focusWithin: boolean
}

/**
 * How much the person sees of a pane (F16), which sets how often the main process draws its output:
 * focused 16 ms, visible 100 ms, hidden nothing until it is shown again.
 */
export function computePanePresence(input: PanePresenceInput): TerminalPresence {
  if (input.hostHidden || !input.onScreen || input.suppressed) return 'hidden'
  return input.active || input.focusWithin ? 'focused' : 'visible'
}

/**
 * The pane's place in its workspace: whether it is the active pane (the store's active pane, or the
 * first pane when that belongs elsewhere, as App resolves it) and whether a sibling is maximized.
 * Encoded as one string so a store selector stays referentially stable.
 */
export function paneRole(panes: readonly WorkspacePane[] | undefined, paneId: string, activePaneId: string | null, maximizedPaneId: string | null): 'active' | 'suppressed' | 'active-suppressed' | 'other' {
  if (!panes?.some(pane => pane.id === paneId)) return 'other'
  const activeId = panes.some(pane => pane.id === activePaneId) ? activePaneId : panes[0]?.id
  const suppressed = maximizedPaneId !== null && maximizedPaneId !== paneId && panes.some(pane => pane.id === maximizedPaneId)
  const active = activeId === paneId
  return active && suppressed ? 'active-suppressed' : active ? 'active' : suppressed ? 'suppressed' : 'other'
}

/** Collapses the hidden → visible → focused bursts of a workspace or view switch into one message. */
export const PRESENCE_DEBOUNCE_MS = 40

const sent = new Map<string, TerminalPresence>()
const pending = new Map<string, { state: TerminalPresence; timer: ReturnType<typeof setTimeout> }>()

function send(paneId: string, state: TerminalPresence): void {
  sent.set(paneId, state)
  void window.oxe?.terminal?.setPresence?.({ paneId, state })?.catch(() => undefined)
}

/**
 * Tells the main process a pane's presence, only when it changed and after a short debounce.
 * `immediate` sends now (unmount: the view is gone, there is nothing to wait for).
 */
export function reportPanePresence(paneId: string, state: TerminalPresence, immediate = false): void {
  const waiting = pending.get(paneId)
  if (waiting) { clearTimeout(waiting.timer); pending.delete(paneId) }
  if (sent.get(paneId) === state) return
  if (immediate) { send(paneId, state); return }
  pending.set(paneId, { state, timer: setTimeout(() => { pending.delete(paneId); send(paneId, state) }, PRESENCE_DEBOUNCE_MS) })
}

/**
 * Sends the pane's presence again. The main process only keeps presence for a session it already
 * has, so a view that mounted while its session was still starting repeats it once the session is there.
 */
export function resendPanePresence(paneId: string): void {
  const state = pending.get(paneId)?.state ?? sent.get(paneId)
  if (!state) return
  sent.delete(paneId)
  reportPanePresence(paneId, state, true)
}

/** Test seam: forgets what was sent. */
export function resetPanePresenceReports(): void {
  for (const { timer } of pending.values()) clearTimeout(timer)
  pending.clear()
  sent.clear()
}
