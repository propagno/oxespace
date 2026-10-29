import type { OxeQueryConnection } from '../../../shared/types/oxequery'
import { tq } from './catalog'

export interface ConnectionSection {
  /** `favorites`, `recent`, `group:<name>` or `ungrouped`. */
  id: string
  title: string
  connections: OxeQueryConnection[]
}

const RECENT_COUNT = 3
const byName = (a: OxeQueryConnection, b: OxeQueryConnection): number => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

/** Whether a connection matches what was typed: its name, group, host, database or engine. */
export function matchesSearch(connection: OxeQueryConnection, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  return [connection.name, connection.group, connection.host, connection.database, connection.engine, connection.environment].some(part => part.toLowerCase().includes(needle))
}

/**
 * The connection list as sections: favorites first, then the few used most recently, then each group,
 * then what has no group. A connection can show in more than one (a favorite also sits in its group),
 * so a person finds it where they look. While searching, there is one flat list of matches.
 */
export function organize(connections: OxeQueryConnection[], search = ''): ConnectionSection[] {
  const matching = connections.filter(connection => matchesSearch(connection, search))
  if (search.trim()) return matching.length ? [{ id: 'results', title: tq('connections.section.matches', { count: matching.length }), connections: [...matching].sort(byName) }] : []
  const sections: ConnectionSection[] = []
  const favorites = matching.filter(connection => connection.favorite).sort(byName)
  if (favorites.length) sections.push({ id: 'favorites', title: tq('connections.section.favorites'), connections: favorites })
  // Recent is for finding the one you were just in; with only a few connections it would repeat the whole list.
  const recent = matching.length > RECENT_COUNT ? [...matching].filter(connection => connection.lastUsedAt > 0 && !connection.ephemeral).sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, RECENT_COUNT) : []
  if (recent.length) sections.push({ id: 'recent', title: tq('connections.section.recent'), connections: recent })
  const groups = new Map<string, OxeQueryConnection[]>()
  for (const connection of matching) {
    const key = connection.ephemeral ? '' : connection.group
    groups.set(key, [...(groups.get(key) ?? []), connection])
  }
  for (const name of [...groups.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))) {
    sections.push({ id: `group:${name}`, title: name, connections: groups.get(name)!.sort(byName) })
  }
  const loose = groups.get('')
  if (loose?.length) {
    const ephemeral = loose.filter(connection => connection.ephemeral).sort(byName)
    if (ephemeral.length) sections.push({ id: 'unsaved', title: tq('connections.section.unsaved'), connections: ephemeral })
    const saved = loose.filter(connection => !connection.ephemeral).sort(byName)
    if (saved.length) sections.push({ id: 'ungrouped', title: groups.size > 1 || sections.length > 0 ? tq('connections.section.other') : tq('connections.title'), connections: saved })
  }
  return sections
}
