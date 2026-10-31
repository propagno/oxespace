import { useCallback, useEffect, useMemo, useState } from 'react'
import { i18n } from '../../../i18n'
import { useThreadStore } from '../../../store/thread.store'
import { humanizeError } from '../../../utils/humanizeError'
import { SECTION_NAME_MAX, sectionErrorCode, type SectionedThread, type ThreadSection } from './sectionsContract'
import { mockAssignments, sectionIdOf, sectionsApi, sectionsUseMock } from './sectionsApi'
import { parentIdOf } from './sectionsContract'
import { moveSectionIds } from './sectionsModel'

/**
 * The words for a section failure. TODO(CCR F13): once the `thread.section.*` codes are in shared/messages.ts,
 * word them from the `main` catalog (messageKey/messageValues) instead of thread.json.
 */
export function sectionErrorText(cause: unknown): string {
  const code = sectionErrorCode(cause)
  const t = i18n.t.bind(i18n)
  if (code === 'thread.section.invalidName') return t('thread:sections.errors.invalidName', { max: SECTION_NAME_MAX })
  if (code === 'thread.section.notFound') return t('thread:sections.errors.notFound')
  if (code === 'thread.section.childFollowsParent') return t('thread:sections.errors.childFollowsParent')
  return humanizeError(cause, t('thread:sections.errors.failed'))
}

export type SectionDialogState =
  | { kind: 'create'; projectId: string; /** Moved into the new section once it exists. */ threadId?: string }
  | { kind: 'rename'; section: ThreadSection }
  | { kind: 'delete'; section: ThreadSection; count: number }

/** Sections of the visible projects, kept current by `thread:sections-changed`, and the actions on them. */
export function useThreadSections(projectIds: readonly string[], threads: readonly SectionedThread[]) {
  const [byProject, setByProject] = useState<Record<string, ThreadSection[]>>({})
  const [assignments, setAssignments] = useState<Record<string, Record<string, string>>>({})
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<SectionDialogState | null>(null)
  const key = projectIds.join('\n')

  useEffect(() => {
    let live = true
    const ids = key ? key.split('\n') : []
    const api = sectionsApi()
    const load = (projectId: string): void => {
      void api.listSections(projectId).then(list => {
        if (!live) return
        setByProject(value => ({ ...value, [projectId]: list }))
        // Read once per change, not once per row and render (empty against the real API).
        setAssignments(value => ({ ...value, [projectId]: mockAssignments(projectId) }))
      }).catch(cause => { if (live) setError(sectionErrorText(cause)) })
    }
    ids.forEach(load)
    const off = api.onSectionsChanged(({ projectId }) => { if (ids.includes(projectId)) load(projectId) })
    return () => { live = false; off() }
  }, [key])

  const sectionOf = useMemo(() => (thread: SectionedThread) => sectionIdOf(thread, threads, projectId => assignments[projectId] ?? {}), [threads, assignments])

  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setError('')
    try {
      await action()
      // The real API changes the summaries: read them again so `sectionId` follows. The mock keeps them itself.
      if (!sectionsUseMock()) void useThreadStore.getState().load()
      return true
    } catch (cause) { setError(sectionErrorText(cause)); return false }
  }, [])

  const api = sectionsApi
  return {
    sectionsOf: (projectId: string): ThreadSection[] => byProject[projectId] ?? [],
    sectionOf,
    error,
    clearError: () => setError(''),
    dialog,
    setDialog,
    moveTo: (thread: SectionedThread, sectionId: string | null) => parentIdOf(thread) ? (setError(sectionErrorText({ code: 'thread.section.childFollowsParent' })), Promise.resolve(false))
      : run(() => api().moveToSection({ threadId: thread.id, sectionId })),
    setCollapsed: (section: ThreadSection, collapsed: boolean) => run(() => api().setSectionCollapsed({ id: section.id, collapsed })),
    shift: (section: ThreadSection, delta: -1 | 1) => {
      const ids = moveSectionIds(byProject[section.projectId] ?? [], section.id, delta)
      return ids ? run(() => api().reorderSections({ projectId: section.projectId, ids })) : Promise.resolve(false)
    },
    /** Throws for the dialog to show the reason under the field. */
    create: async (projectId: string, name: string, threadId?: string): Promise<ThreadSection> => {
      const section = await api().createSection({ projectId, name })
      if (threadId) await run(() => api().moveToSection({ threadId, sectionId: section.id }))
      return section
    },
    rename: (section: ThreadSection, name: string) => api().renameSection({ id: section.id, name }),
    remove: (section: ThreadSection) => api().deleteSection({ id: section.id })
  }
}

export type ThreadSectionsController = ReturnType<typeof useThreadSections>
