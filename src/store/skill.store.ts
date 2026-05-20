import { create } from 'zustand'
import type { SkillDefinition } from '../../shared/types/skill'

interface SkillStoreState {
  skills: SkillDefinition[]
  loading: boolean
  error: string | null
  loaded: boolean
  refresh: (workspaceRootPath?: string) => Promise<void>
  invoke: (skillName: string, paneId: string, argument?: string) => Promise<void>
  subscribe: () => () => void
}

export const useSkillStore = create<SkillStoreState>((set, get) => ({
  skills: [],
  loading: false,
  error: null,
  loaded: false,

  refresh: async (workspaceRootPath) => {
    set({ loading: true })
    try {
      const skills = await window.oxe.skill.list({ workspaceRootPath })
      set({ skills, loading: false, error: null, loaded: true })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : String(err), loaded: true })
    }
  },

  invoke: async (skillName, paneId, argument) => {
    await window.oxe.skill.invoke({ skillName, paneId, argument })
  },

  subscribe: () => {
    const off = window.oxe.skill.onChange(() => {
      // Re-fetch on any change; cheap because the registry is in-memory.
      void get().refresh()
    })
    return off
  }
}))
