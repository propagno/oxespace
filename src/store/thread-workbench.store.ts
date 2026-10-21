import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThreadPanel = 'changes' | 'git' | 'files' | 'search' | 'scripts' | 'background' | 'preview' | 'terminal'
/** `turnId`: Changes shows only what that turn changed, instead of the whole branch. */
export interface ThreadWorkbenchView { panel: ThreadPanel | null; selection?: string; turnId?: string }
interface WorkbenchState {
  views: Record<string, ThreadWorkbenchView>
  width: number
  setView(id: string, value: Partial<ThreadWorkbenchView>): void
  setWidth(width: number): void
}
export const useThreadWorkbenchStore = create<WorkbenchState>()(persist(set => ({
  views: {}, width: 420,
  // Choosing a panel without a turn leaves the turn view, so the header's Changes shows the whole branch again.
  setView: (id, value) => set(state => ({ views: { ...state.views, [id]: { ...(state.views[id] ?? { panel: null }), ...(value.panel !== undefined && !('turnId' in value) ? { turnId: undefined } : {}), ...value } } })),
  setWidth: width => set({ width: Math.max(320, Math.min(720, width)) })
}), { name: 'oxespace-thread-workbench', partialize: state => ({ width: state.width }) }))
