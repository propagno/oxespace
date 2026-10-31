/**
 * TODO(CCR F13): stand-in for the sections API until the contract lands in the main process. It keeps one record
 * per project in localStorage (memory when storage is blocked) and follows the contract's rules and C3 codes, so
 * the list, its tests and e2e behave as they will against the real API.
 */
import { normalizeSectionName, sameSectionName, SECTION_NAME_MAX, SectionError, type ThreadSection, type ThreadSectionsApi } from './sectionsContract'

export const SECTIONS_STORAGE_PREFIX = 'oxe-thread-sections:'

interface ProjectRecord { sections: ThreadSection[]; assignments: Record<string, string> }
export interface ThreadLookup { projectId: string; parentThreadId?: string | null }

/** localStorage with every access guarded; a private window or blocked storage falls back to memory. */
export interface SectionsStorage { get(key: string): string | null; set(key: string, value: string): void; keys(): string[] }

export function browserStorage(): SectionsStorage {
  const memory = new Map<string, string>()
  return {
    get: key => { try { return window.localStorage.getItem(key) ?? memory.get(key) ?? null } catch { return memory.get(key) ?? null } },
    set: (key, value) => { memory.set(key, value); try { window.localStorage.setItem(key, value) } catch { /* memory keeps it for this session */ } },
    keys: () => {
      const found = new Set(memory.keys())
      try { for (let index = 0; index < window.localStorage.length; index++) { const key = window.localStorage.key(index); if (key) found.add(key) } } catch { /* memory only */ }
      return [...found]
    }
  }
}

export interface SectionsMock extends ThreadSectionsApi {
  /** threadId → sectionId for a project's conversations (children not listed: they follow their parent). */
  assignments(projectId: string): Record<string, string>
}

export function createSectionsMock(options: { storage: SectionsStorage; lookup: (threadId: string) => ThreadLookup | undefined; now?: () => number; newId?: () => string }): SectionsMock {
  const { storage, lookup } = options
  const now = options.now ?? Date.now
  const newId = options.newId ?? (() => `section-${globalThis.crypto?.randomUUID?.() ?? `${now().toString(36)}-${Math.random().toString(36).slice(2)}`}`)
  const listeners = new Set<(event: { projectId: string }) => void>()

  const read = (projectId: string): ProjectRecord => {
    try {
      const value = JSON.parse(storage.get(SECTIONS_STORAGE_PREFIX + projectId) ?? 'null') as Partial<ProjectRecord> | null
      return { sections: Array.isArray(value?.sections) ? value.sections : [], assignments: value?.assignments && typeof value.assignments === 'object' ? value.assignments : {} }
    } catch { return { sections: [], assignments: {} } }
  }
  const write = (projectId: string, record: ProjectRecord): void => {
    record.sections = [...record.sections].sort((a, b) => a.order - b.order).map((section, order) => ({ ...section, order }))
    storage.set(SECTIONS_STORAGE_PREFIX + projectId, JSON.stringify(record))
    for (const listener of [...listeners]) listener({ projectId })
  }
  const owner = (id: string): { projectId: string; record: ProjectRecord; section: ThreadSection } => {
    for (const key of storage.keys()) {
      if (!key.startsWith(SECTIONS_STORAGE_PREFIX)) continue
      const projectId = key.slice(SECTIONS_STORAGE_PREFIX.length), record = read(projectId)
      const section = record.sections.find(item => item.id === id)
      if (section) return { projectId, record, section }
    }
    throw new SectionError('thread.section.notFound')
  }
  const validName = (name: string, record: ProjectRecord, except?: string): string => {
    const valid = normalizeSectionName(name)
    if (!valid) throw new SectionError('thread.section.invalidName', { max: SECTION_NAME_MAX })
    // One name per project, whatever its case: two "Work" sections cannot be told apart.
    if (record.sections.some(section => section.id !== except && sameSectionName(section.name, valid))) throw new SectionError('thread.section.duplicateName')
    return valid
  }
  const sorted = (record: ProjectRecord): ThreadSection[] => [...record.sections].sort((a, b) => a.order - b.order)

  return {
    assignments: projectId => ({ ...read(projectId).assignments }),
    async listSections(projectId) { return sorted(read(projectId)) },
    async createSection({ projectId, name }) {
      const record = read(projectId)
      const section: ThreadSection = { id: newId(), projectId, name: validName(name, record), order: record.sections.length, collapsed: false, createdAt: now() }
      record.sections.push(section); write(projectId, record)
      return section
    },
    async renameSection({ id, name }) {
      const { projectId, record, section } = owner(id)
      const valid = validName(name, record, id)
      section.name = valid; write(projectId, record)
      return { ...section }
    },
    async deleteSection({ id }) {
      const { projectId, record } = owner(id)
      record.sections = record.sections.filter(section => section.id !== id)
      record.assignments = Object.fromEntries(Object.entries(record.assignments).filter(([, sectionId]) => sectionId !== id))
      write(projectId, record)
    },
    async reorderSections({ projectId, ids }) {
      const record = read(projectId)
      const known = new Set(record.sections.map(section => section.id))
      if (ids.length !== known.size || new Set(ids).size !== ids.length || ids.some(id => !known.has(id))) throw new SectionError('thread.section.notFound')
      record.sections = record.sections.map(section => ({ ...section, order: ids.indexOf(section.id) }))
      write(projectId, record)
      return sorted(read(projectId))
    },
    async setSectionCollapsed({ id, collapsed }) {
      const { projectId, record, section } = owner(id)
      section.collapsed = collapsed; write(projectId, record)
      return { ...section }
    },
    async moveToSection({ threadId, sectionId }) {
      const thread = lookup(threadId)
      if (!thread) throw new SectionError('thread.section.notFound')
      if (thread.parentThreadId) throw new SectionError('thread.section.childFollowsParent')
      const record = read(thread.projectId)
      if (sectionId === null) delete record.assignments[threadId]
      else if (!record.sections.some(section => section.id === sectionId)) throw new SectionError('thread.section.notFound')
      else record.assignments[threadId] = sectionId
      write(thread.projectId, record)
    },
    onSectionsChanged(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }
  }
}
