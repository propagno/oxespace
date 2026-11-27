import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const REVIEW_MIN_WIDTH = 320
export const REVIEW_DEFAULT_WIDTH = 420
/** The conversation keeps at least this much beside the side panel. */
export const CONVERSATION_MIN_WIDTH = 360

export type ThreadPanel = 'session' | 'changes' | 'plan' | 'git' | 'files' | 'search' | 'background' | 'preview' | 'terminal' | 'requests' | 'network' | 'android' | 'queries' | 'containers'
/** `turnId`: Changes shows only what that turn changed, instead of the whole branch. `width`: this conversation's panel width (OXC-4). */
export interface ThreadWorkbenchView { panel: ThreadPanel | null; selection?: string; turnId?: string; width?: number }
interface WorkbenchState {
  views: Record<string, ThreadWorkbenchView>
  /** The width of the focused conversation's panel; each conversation keeps its own in `views[id].width`. */
  width: number
  /** The conversation the panel width follows (the active cell). */
  focusedId: string | null
  /** The conversation whose side panel takes the whole workbench (the conversation steps aside); Esc or the button restores. */
  maximizedId: string | null
  setView(id: string, value: Partial<ThreadWorkbenchView>): void
  setWidth(width: number): void
  focus(id: string | null): void
  setMaximized(id: string | null): void
}
// The upper limit depends on the window, so the host clamps it; the store only keeps it sane.
const saneWidth = (width: number): number => Math.round(Math.max(REVIEW_MIN_WIDTH, Math.min(4000, width)))
export const useThreadWorkbenchStore = create<WorkbenchState>()(persist(set => ({
  views: {}, width: REVIEW_DEFAULT_WIDTH, focusedId: null, maximizedId: null,
  // Choosing a panel without a turn leaves the turn view, so the header's Changes shows the whole branch again.
  setView: (id, value) => set(state => ({ views: { ...state.views, [id]: {
    ...(state.views[id] ?? { panel: null }),
    ...(value.panel !== undefined && !('turnId' in value) ? { turnId: undefined } : {}),
    ...value,
    ...(value.width !== undefined ? { width: saneWidth(value.width) } : {})
  } }, ...(value.width !== undefined && id === state.focusedId ? { width: saneWidth(value.width) } : {}) })),
  setWidth: width => set(state => {
    const next = saneWidth(width), id = state.focusedId
    return id ? { width: next, views: { ...state.views, [id]: { ...(state.views[id] ?? { panel: null }), width: next } } } : { width: next }
  }),
  // The panel width follows the conversation shown: one set for another conversation does not move this one's.
  focus: id => set(state => state.focusedId === id ? state : { focusedId: id, width: id ? state.views[id]?.width ?? REVIEW_DEFAULT_WIDTH : state.width }),
  setMaximized: id => set({ maximizedId: id })
}), {
  name: 'oxespace-thread-workbench',
  partialize: state => ({
    width: state.width,
    views: Object.fromEntries(Object.entries(state.views).flatMap(([id, view]): Array<[string, ThreadWorkbenchView]> => view.width === undefined ? [] : [[id, { panel: null, width: view.width }]]))
  })
}))
