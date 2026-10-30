import { create } from 'zustand'
import { i18n } from '../i18n'
import type { CreateSkillInput, SkillDefinition } from '../../shared/types/skill'
import { humanizeError } from '../utils/humanizeError'
import { optimistic } from './optimistic'

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
      set({ loading: false, error: humanizeError(err), loaded: true })
    }
  },

  invoke: async (skillName, paneId, argument) => {
    await window.oxe.skill.invoke({ skillName, paneId, argument })
  },

  createSkill: async (input) => {
    // The skill shows in the list at once, with the file path still empty; the saved definition replaces it. The
    // onChange subscription re-syncs from disk moments later. A skill with the same name is replaced, as workspace
    // skills override user skills. On failure the list goes back and the form that asked shows the error.
    const pending: SkillDefinition = { name: input.name, description: input.description, agents: input.agents, category: input.category, body: input.body ?? '', filePath: '', source: input.scope, mtimeMs: 0 }
    const insert = (skills: SkillDefinition[], skill: SkillDefinition): SkillDefinition[] => [...skills.filter((s) => s.name !== skill.name), skill].sort(sortSkills)
    const previous = get().skills.find((s) => s.name === input.name)
    const created = await optimistic(set, get, (state) => ({ skills: insert(state.skills, pending), error: null }), () => window.oxe.skill.create(input), {
      rollbackMessage: i18n.t('failures.skillCreate'),
      rethrow: true,
      reconcile: (skill, state) => ({ skills: insert(state.skills, skill) }),
      revert: (state) => ({ skills: previous ? insert(state.skills, previous) : state.skills.filter((s) => s !== pending) })
    })
    return created!
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
