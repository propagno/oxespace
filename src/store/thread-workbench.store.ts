import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const REVIEW_MIN_WIDTH = 320
export const REVIEW_DEFAULT_WIDTH = 420
/** The conversation keeps at least this much beside the side panel. */
export const CONVERSATION_MIN_WIDTH = 360

export type ThreadPanel = 'changes' | 'git' | 'files' | 'search' | 'scripts' | 'background' | 'preview' | 'terminal'
/** `turnId`: Changes shows only what that turn changed, instead of the whole branch. */
export interface ThreadWorkbenchView { panel: ThreadPanel | null; selection?: string; turnId?: string }
interface WorkbenchState {
  views: Record<string, ThreadWorkbenchView>
  width: number
  /** The conversation whose side panel takes the whole workbench (the conversation steps aside); Esc or the button restores. */
  maximizedId: string | null
  setView(id: string, value: Partial<ThreadWorkbenchView>): void
  setWidth(width: number): void
  setMaximized(id: string | null): void
}
export const useThreadWorkbenchStore = create<WorkbenchState>()(persist(set => ({
  views: {}, width: REVIEW_DEFAULT_WIDTH, maximizedId: null,
  // Choosing a panel without a turn leaves the turn view, so the header's Changes shows the whole branch again.
  setView: (id, value) => set(state => ({ views: { ...state.views, [id]: { ...(state.views[id] ?? { panel: null }), ...(value.panel !== undefined && !('turnId' in value) ? { turnId: undefined } : {}), ...value } } })),
  // The upper limit depends on the window, so the host clamps it; the store only keeps it sane.
  setWidth: width => set({ width: Math.round(Math.max(REVIEW_MIN_WIDTH, Math.min(4000, width))) }),
  setMaximized: id => set({ maximizedId: id })
}), { name: 'oxespace-thread-workbench', partialize: state => ({ width: state.width }) }))

// bisect only (F7.3): which fields change during a cold switch
useThreadWorkbenchStore.subscribe((next, prev) => { const w = window as unknown as { __stores?: Record<string, number> }; w.__stores ??= {}
  for (const key of Object.keys(next)) if ((next as unknown as Record<string, unknown>)[key] !== (prev as unknown as Record<string, unknown>)[key]) w.__stores['ThreadWorkbench.' + key] = (w.__stores['ThreadWorkbench.' + key] ?? 0) + 1 })
