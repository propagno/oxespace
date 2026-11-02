import type { ThreadApi } from '../../../../shared/types/thread'
import type { ThreadSections, ThreadSectionsRefusal } from '../../../../shared/types/thread-sections'
import { i18n } from '../../../i18n'
import { formatMainMessage } from '../../../i18n/mainMessage'
import { useThreadStore } from '../../../store/thread.store'
import { toast } from '../../../ui'
import { normalizeSectionName, sameSectionName, SECTION_NAME_MAX, SectionError, type SectionedThread, type ThreadSection, type ThreadSectionsApi } from './sectionsContract'

/**
 * F13 · Sections of the conversation list, kept by the main process (#284: `thread:sections` and
 * `thread:sections-save`, per conversation workspace). Main reads and saves a workspace's whole state; the list
 * changes one thing at a time, so each change here reads the state it knows, applies the change with the same rules
 * as main, and saves it, one save at a time per workspace. A refusal leaves the state as it was.
 *
 * Before the main process kept them, the list kept sections in localStorage (`oxe-thread-sections:<project id>`).
 * The first load of a project whose workspace has none in main moves them there once and forgets the local copy.
 */
export const LEGACY_STORAGE_PREFIX = 'oxe-thread-sections:'

type Bridge = Required<Pick<ThreadApi, 'sections' | 'saveSections'>>

function bridge(): Bridge | null {
  const thread = typeof window === 'undefined' ? undefined : window.oxe?.thread
  return thread?.sections && thread.saveSections ? thread as Bridge : null
}

/**
 * The key a project's sections are kept under in main: the Thread project's own, whatever workspace each of its
 * conversations carries (a delegated or Work run conversation may carry a Code workspace's).
 */
export const sectionsWorkspaceOf = (projectId: string): string => `thread:${projectId}`

const REFUSAL_CODE: Partial<Record<ThreadSectionsRefusal, 'thread.section.invalidName' | 'thread.section.duplicateName'>> = {
  nameEmpty: 'thread.section.invalidName', nameTooLong: 'thread.section.invalidName', nameHidden: 'thread.section.invalidName', nameDuplicate: 'thread.section.duplicateName'
}

interface Store extends ThreadSectionsApi {
  /** A project's conversation id → section id, as last read (children are not listed: they follow their parent). */
  assignments(projectId: string): Record<string, string>
}

function createStore(): Store {
  const states = new Map<string, ThreadSections>()
  const pending = new Map<string, Promise<unknown>>()
  const listeners = new Set<(event: { projectId: string }) => void>()
  const projectOfSection = new Map<string, string>()

  const toSections = (projectId: string, state: ThreadSections): ThreadSection[] =>
    [...state.sections].sort((a, b) => a.order - b.order).map(section => {
      projectOfSection.set(section.id, projectId)
      return { id: section.id, projectId, name: section.name, order: section.order, collapsed: section.collapsed === true }
    })

  /** One read or save at a time per workspace, so a change always starts from the state the last one left. */
  const queued = <T>(workspaceId: string, work: () => Promise<T>): Promise<T> => {
    const run = (pending.get(workspaceId) ?? Promise.resolve()).catch(() => undefined).then(work)
    pending.set(workspaceId, run)
    return run
  }

  const required = (): Bridge => {
    const api = bridge()
    if (!api) throw new SectionError('thread.section.notFound')
    return api
  }

  async function read(projectId: string): Promise<ThreadSections> {
    const workspaceId = sectionsWorkspaceOf(projectId)
    const known = states.get(workspaceId)
    if (known) return known
    const state = await migrate(projectId, workspaceId, await required().sections(workspaceId))
    states.set(workspaceId, state)
    return state
  }

  async function save(projectId: string, change: (state: ThreadSections) => ThreadSections): Promise<ThreadSections> {
    const workspaceId = sectionsWorkspaceOf(projectId)
    return queued(workspaceId, async () => {
      const next = change(structuredClone(await read(projectId)))
      const result = await required().saveSections(workspaceId, next)
      // A name refusal is worded under the field; any other in main's words (C3), never as its code.
      if (!result.ok) throw REFUSAL_CODE[result.refusal] ? new SectionError(REFUSAL_CODE[result.refusal]!, { max: SECTION_NAME_MAX }) : new Error(formatMainMessage(result.message))
      states.set(workspaceId, result.state)
      for (const listener of [...listeners]) listener({ projectId })
      return result.state
    })
  }

  /** Moves a project's localStorage sections to main once, when main has none for its workspace yet. */
  async function migrate(projectId: string, workspaceId: string, stored: ThreadSections): Promise<ThreadSections> {
    const legacy = readLegacy(projectId)
    if (!legacy) return stored
    if (stored.sections.length) {
      // Main already keeps this project's sections: they win, and the local copy is not merged in.
      forgetLegacy(projectId)
      reportNotKept(legacy.sections.map(section => section.name))
      return stored
    }
    const sections = legacy.sections.filter(section => normalizeSectionName(section.name))
      .filter((section, index, list) => list.findIndex(other => sameSectionName(other.name, section.name)) === index)
      .sort((a, b) => a.order - b.order).map((section, order) => ({ id: section.id, name: normalizeSectionName(section.name)!, order, collapsed: section.collapsed === true }))
    const ids = new Set(sections.map(section => section.id))
    const assignments = Object.fromEntries(Object.entries(legacy.assignments).filter(([, sectionId]) => ids.has(sectionId)))
    const result = await required().saveSections(workspaceId, { sections, assignments })
    // Kept locally when main refuses, so nothing is lost; the next start tries again.
    if (!result.ok) return stored
    forgetLegacy(projectId)
    // An empty or invalid name, or a second section with the same name, is not carried over: said once.
    reportNotKept(legacy.sections.filter(section => !ids.has(section.id)).map(section => section.name))
    return result.state
  }

  const sectionProject = (id: string): string => {
    const projectId = projectOfSection.get(id)
    if (!projectId) throw new SectionError('thread.section.notFound')
    return projectId
  }
  const named = (state: ThreadSections, name: string, except?: string): string => {
    const valid = normalizeSectionName(name)
    if (!valid) throw new SectionError('thread.section.invalidName', { max: SECTION_NAME_MAX })
    if (state.sections.some(section => section.id !== except && sameSectionName(section.name, valid))) throw new SectionError('thread.section.duplicateName')
    return valid
  }
  const existing = (state: ThreadSections, id: string) => {
    const section = state.sections.find(item => item.id === id)
    if (!section) throw new SectionError('thread.section.notFound')
    return section
  }
  const newId = (): string => `section-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`

  return {
    assignments: projectId => ({ ...(states.get(sectionsWorkspaceOf(projectId))?.assignments ?? {}) }),
    listSections: async projectId => toSections(projectId, await queued(sectionsWorkspaceOf(projectId), () => read(projectId))),
    async createSection({ projectId, name }) {
      let id = ''
      const state = await save(projectId, current => {
        id = newId()
        return { ...current, sections: [...current.sections, { id, name: named(current, name), order: current.sections.length, collapsed: false }] }
      })
      return toSections(projectId, state).find(section => section.id === id)!
    },
    async renameSection({ id, name }) {
      const projectId = sectionProject(id)
      const state = await save(projectId, current => {
        existing(current, id).name = named(current, name, id)
        return current
      })
      return toSections(projectId, state).find(section => section.id === id)!
    },
    async deleteSection({ id }) {
      await save(sectionProject(id), current => {
        existing(current, id)
        return { sections: current.sections.filter(section => section.id !== id), assignments: Object.fromEntries(Object.entries(current.assignments).filter(([, sectionId]) => sectionId !== id)) }
      })
    },
    async reorderSections({ projectId, ids }) {
      const state = await save(projectId, current => {
        const known = new Set(current.sections.map(section => section.id))
        if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some(id => !known.has(id))) throw new SectionError('thread.section.notFound')
        return { ...current, sections: current.sections.map(section => ({ ...section, order: ids.indexOf(section.id) })) }
      })
      return toSections(projectId, state)
    },
    async setSectionCollapsed({ id, collapsed }) {
      const projectId = sectionProject(id)
      const state = await save(projectId, current => {
        existing(current, id).collapsed = collapsed
        return current
      })
      return toSections(projectId, state).find(section => section.id === id)!
    },
    async moveToSection({ threadId, sectionId }) {
      const thread = useThreadStore.getState().threads.find(item => item.id === threadId) as SectionedThread | undefined
      if (!thread) throw new SectionError('thread.section.notFound')
      if (thread.parentThreadId) throw new SectionError('thread.section.childFollowsParent')
      await save(thread.projectId, current => {
        const assignments = { ...current.assignments }
        if (sectionId === null) delete assignments[threadId]
        else { existing(current, sectionId); assignments[threadId] = sectionId }
        return { ...current, assignments }
      })
    },
    onSectionsChanged(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }
  }
}

/** One notice for the sections a move to main left out; their names go to the console only. */
function reportNotKept(names: readonly string[]): void {
  if (!names.length) return
  console.info('[OXESpace] sections not carried over from this window:', names)
  toast({ title: i18n.t('thread:sections.notKept', { count: names.length }), intent: 'info' })
}

interface LegacyRecord { sections: Array<{ id: string; name: string; order: number; collapsed?: boolean }>; assignments: Record<string, string> }

function readLegacy(projectId: string): LegacyRecord | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(LEGACY_STORAGE_PREFIX + projectId) ?? 'null') as Partial<LegacyRecord> | null
    if (!value || !Array.isArray(value.sections)) return null
    const sections = value.sections.filter(section => section && typeof section.id === 'string' && typeof section.name === 'string')
    const assignments = value.assignments && typeof value.assignments === 'object'
      ? Object.fromEntries(Object.entries(value.assignments).filter(([, sectionId]) => typeof sectionId === 'string')) as Record<string, string>
      : {}
    return sections.length ? { sections: sections.map(section => ({ ...section, order: Number(section.order) || 0 })), assignments } : null
  } catch { return null }
}

function forgetLegacy(projectId: string): void {
  try { window.localStorage.removeItem(LEGACY_STORAGE_PREFIX + projectId) } catch { /* nothing kept to forget */ }
}

let store: Store | null = null

/** Sections of the conversation list, kept by the main process. */
export function sectionsApi(): ThreadSectionsApi {
  store ??= createStore()
  return store
}

/**
 * The section a conversation shows in: its entry in the project's assignments; a child follows its parent.
 * `assignmentsOf` gives the assignments the list last read.
 */
export function sectionIdOf(thread: SectionedThread, threads: readonly SectionedThread[], assignmentsOf: (projectId: string) => Record<string, string> = projectAssignments): string | null {
  const assignments = assignmentsOf(thread.projectId)
  const parent = thread.parentThreadId ? threads.find(item => item.id === thread.parentThreadId) : undefined
  return assignments[(parent ?? thread).id] ?? null
}

/** A project's threadId → sectionId map, as last read from main. */
export function projectAssignments(projectId: string): Record<string, string> {
  store ??= createStore()
  return store.assignments(projectId)
}

/** Tests only: forget what was read, so the next call asks main again. */
export function resetSectionsForTests(): void { store = null }
