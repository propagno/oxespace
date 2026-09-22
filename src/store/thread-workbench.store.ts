import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThreadPanel = 'changes' | 'project' | 'source' | 'files' | 'search' | 'scripts' | 'background' | 'preview' | 'terminal' | 'agents' | 'activity' | 'plan' | 'diagnostics'
export interface ThreadWorkbenchView { panel: ThreadPanel | null; selection?: string }
interface WorkbenchState {
  views: Record<string, ThreadWorkbenchView>
  width: number
  setView(id: string, value: Partial<ThreadWorkbenchView>): void
  setWidth(width: number): void
}
export const useThreadWorkbenchStore = create<WorkbenchState>()(persist(set => ({
  views: {}, width: 420,
  setView: (id, value) => set(state => ({ views: { ...state.views, [id]: { ...(state.views[id] ?? { panel: null }), ...value } } })),
  setWidth: width => set({ width: Math.max(320, Math.min(720, width)) })
}), { name: 'oxespace-thread-workbench', partialize: state => ({ width: state.width }) }))
