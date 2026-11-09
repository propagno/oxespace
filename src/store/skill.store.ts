import { create } from 'zustand'
import type { SkillDefinition } from '../../shared/types/skill'
import { humanizeError } from '../utils/humanizeError'

/**
 * The skills agents can run: listed in Settings › Tools (read only) and in the command bar, which invokes them for a
 * pane. Skills are Markdown files written by the person or by an agent through MCP; the renderer never creates one (R12).
 */
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
      set({ loading: false, error: humanizeError(err), loaded: true })
    }
  },

  invoke: async (skillName, paneId, argument) => {
    await window.oxe.skill.invoke({ skillName, paneId, argument })
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
