import type { ThreadSection } from './sectionsContract'

export interface SectionGroup<T> { section: ThreadSection; threads: T[] }

/**
 * Splits a project's conversations (already filtered and ordered) into its sections, in section order, and the
 * ones in no section. A conversation pointing at a section that no longer exists shows with no section.
 */
export function groupBySection<T>(threads: readonly T[], sections: readonly ThreadSection[], sectionOf: (thread: T) => string | null): { sections: SectionGroup<T>[]; loose: T[] } {
  const groups = [...sections].sort((a, b) => a.order - b.order).map(section => ({ section, threads: [] as T[] }))
  const byId = new Map(groups.map(group => [group.section.id, group]))
  const loose: T[] = []
  for (const thread of threads) {
    const id = sectionOf(thread)
    const group = id ? byId.get(id) : undefined
    if (group) group.threads.push(thread)
    else loose.push(thread)
  }
  return { sections: groups, loose }
}

/** The project's section ids with `id` moved one place up (-1) or down (+1); null when it cannot move. */
export function moveSectionIds(sections: readonly ThreadSection[], id: string, delta: -1 | 1): string[] | null {
  const ids = [...sections].sort((a, b) => a.order - b.order).map(section => section.id)
  const from = ids.indexOf(id), to = from + delta
  if (from < 0 || to < 0 || to >= ids.length) return null
  ids.splice(from, 1)
  ids.splice(to, 0, id)
  return ids
}
