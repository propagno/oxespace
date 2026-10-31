import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const RECENT_COMMANDS_MAX = 8

interface CommandHistoryState {
  /** Ids of the last palette commands run, newest first. */
  recent: string[]
  record: (id: string) => void
}

/** The palette's "Recent" group, kept across restarts. */
export const useCommandHistoryStore = create<CommandHistoryState>()(
  persist(
    set => ({
      recent: [],
      record: id => set(state => ({ recent: [id, ...state.recent.filter(item => item !== id)].slice(0, RECENT_COMMANDS_MAX) }))
    }),
    {
      name: 'oxe-command-history',
      version: 1,
      partialize: state => ({ recent: state.recent }),
      merge: (persisted, current) => {
        const recent = (persisted as { recent?: unknown } | undefined)?.recent
        return { ...current, recent: Array.isArray(recent) ? recent.filter((id): id is string => typeof id === 'string').slice(0, RECENT_COMMANDS_MAX) : [] }
      }
    }
  )
)
