import { useThreadStore } from '../../../store/thread.store'
import type { SectionedThread, ThreadSectionsApi } from './sectionsContract'
import { parentIdOf } from './sectionsContract'
import { browserStorage, createSectionsMock, type SectionsMock } from './sectionsMock'

let mock: SectionsMock | null = null

/** The real bridge when the preload exposes every contract method (TODO(CCR F13): always, once it lands). */
function realApi(): ThreadSectionsApi | null {
  const thread = (typeof window === 'undefined' ? undefined : window.oxe?.thread) as Partial<ThreadSectionsApi> | undefined
  const methods: (keyof ThreadSectionsApi)[] = ['listSections', 'createSection', 'renameSection', 'deleteSection', 'reorderSections', 'setSectionCollapsed', 'moveToSection', 'onSectionsChanged']
  return thread && methods.every(method => typeof thread[method] === 'function') ? thread as ThreadSectionsApi : null
}

function localMock(): SectionsMock {
  mock ??= createSectionsMock({
    storage: browserStorage(),
    lookup: threadId => {
      const thread = useThreadStore.getState().threads.find(item => item.id === threadId) as SectionedThread | undefined
      return thread && { projectId: thread.projectId, parentThreadId: parentIdOf(thread) }
    }
  })
  return mock
}

/** Sections of the conversation list: `window.oxe.thread` when it has them, otherwise the localStorage mock. */
export function sectionsApi(): ThreadSectionsApi {
  return realApi() ?? localMock()
}

/** True while the preload lacks the contract and the list keeps sections in the renderer. */
export function sectionsUseMock(): boolean { return !realApi() }

/**
 * The section a conversation shows in. The real summary carries `sectionId` (a child already reports its parent's);
 * against the mock it comes from the mock's assignments, and a child follows its parent.
 */
export function sectionIdOf(thread: SectionedThread, threads: readonly SectionedThread[], assignmentsOf: (projectId: string) => Record<string, string> = projectId => localMock().assignments(projectId)): string | null {
  if (realApi()) return thread.sectionId ?? null
  const assignments = assignmentsOf(thread.projectId)
  const parentId = parentIdOf(thread)
  const parent = parentId ? threads.find(item => item.id === parentId) : undefined
  return assignments[(parent ?? thread).id] ?? null
}

/** The mock's threadId → sectionId map of a project (empty once the real API is in use). */
export function mockAssignments(projectId: string): Record<string, string> {
  return realApi() ? {} : localMock().assignments(projectId)
}

/** Tests only: forget the mock so the next call reads storage again. */
export function resetSectionsMockForTests(): void { mock = null }
