import { create } from 'zustand'
import type { CreateSkillInput, SkillDefinition } from '../../shared/types/skill'

interface SkillStoreState {
  skills: SkillDefinition[]
  loading: boolean
  error: string | null
  loaded: boolean
  refresh: (workspaceRootPath?: string) => Promise<void>
  invoke: (skillName: string, paneId: string, argument?: string) => Promise<void>
  createSkill: (input: CreateSkillInput) => Promise<SkillDefinition>
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

  createSkill: async (input) => {
    const created = await window.oxe.skill.create(input)
    set((state) => {
      // Optimistic insert (the onChange subscription will re-sync from disk
      // moments later, but this keeps the UI responsive). Replace any existing
      // entry with the same name — workspace skills override user skills.
      const filtered = state.skills.filter((s) => s.name !== created.name)
      return { skills: [...filtered, created].sort(sortSkills), error: null }
    })
    return created
  },

  subscribe: () => {
    if (!window.oxe?.skill?.onChange) return () => undefined
    const off = window.oxe.skill.onChange(() => {
      // Re-fetch on any change; cheap because the registry is in-memory.
      void get().refresh()
    })
    return off
  }
}))

function sortSkills(a: SkillDefinition, b: SkillDefinition): number {
  // Mirrors SkillService.listSkills ordering: workspace overrides first, then user, alphabetical.
  if (a.source !== b.source) return a.source === 'workspace' ? -1 : 1
  return a.name.localeCompare(b.name)
}
