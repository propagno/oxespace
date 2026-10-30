import { create } from 'zustand'

/**
 * How much of the agent's work the transcript shows.
 * - summary: only messages, requests and the files that changed
 * - normal: tool calls collapsed into one-line summaries (default)
 * - verbose: every action with its own row and details
 */
export type ThreadViewMode = 'summary' | 'normal' | 'verbose'
export const THREAD_VIEW_MODES: ThreadViewMode[] = ['summary', 'normal', 'verbose']

const KEY = 'oxe.thread.viewMode'

function read(): ThreadViewMode {
  try {
    const value = localStorage.getItem(KEY)
    return THREAD_VIEW_MODES.includes(value as ThreadViewMode) ? value as ThreadViewMode : 'normal'
  } catch { return 'normal' }
}

interface ThreadViewModeState {
  mode: ThreadViewMode
  setMode(mode: ThreadViewMode): void
  /** Ctrl+O: summary → normal → verbose → summary. */
  cycle(): void
}

export const useThreadViewModeStore = create<ThreadViewModeState>((set, get) => ({
  mode: read(),
  setMode: mode => {
    try { localStorage.setItem(KEY, mode) } catch { /* private mode */ }
    set({ mode })
  },
  cycle: () => get().setMode(THREAD_VIEW_MODES[(THREAD_VIEW_MODES.indexOf(get().mode) + 1) % THREAD_VIEW_MODES.length])
}))
