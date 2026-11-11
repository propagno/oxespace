import { create } from 'zustand'

export type PaneConversationMode = 'terminal' | 'conversation'

interface PaneConversationViewState {
  views: Record<string, PaneConversationMode>
  getMode: (paneId: string) => PaneConversationMode
  setMode: (paneId: string, mode: PaneConversationMode) => void
  clear: (paneId: string) => void
}

export const usePaneConversationView = create<PaneConversationViewState>((set, get) => ({
  views: {},
  getMode: (paneId) => get().views[paneId] ?? 'terminal',
  setMode: (paneId, mode) =>
    set((state) => {
      if ((state.views[paneId] ?? 'terminal') === mode) return state
      return { views: { ...state.views, [paneId]: mode } }
    }),
  clear: (paneId) =>
    set((state) => {
      if (!(paneId in state.views)) return state
      const next = { ...state.views }
      delete next[paneId]
      return { views: next }
    })
}))
