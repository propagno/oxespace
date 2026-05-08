import { create } from 'zustand'

export type TerminalPaneStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error'

interface TerminalStateEntry {
  status: TerminalPaneStatus
  error: string | null
}

interface TerminalState {
  panes: Record<string, TerminalStateEntry>
  setStatus: (paneId: string, status: TerminalPaneStatus, error?: string | null) => void
  getStatus: (paneId: string) => TerminalStateEntry
}

const DEFAULT_STATE: TerminalStateEntry = {
  status: 'idle',
  error: null
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  panes: {},
  setStatus: (paneId, status, error = null) =>
    set((state) => ({
      panes: {
        ...state.panes,
        [paneId]: { status, error }
      }
    })),
  getStatus: (paneId) => get().panes[paneId] ?? DEFAULT_STATE
}))
