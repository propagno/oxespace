import type { SavedQuery } from '../../../shared/types/oxequery'

export interface SavedGroup { folder: string; items: { query: SavedQuery; label: string }[] }

/**
 * Saved queries grouped by folder. A folder is the part of the name before its first slash
 * (`Reports/Monthly totals`); a name without one, or with an empty side, stays at the top level.
 * No extra storage: the name is the path.
 */
export function groupSaved(saved: SavedQuery[]): SavedGroup[] {
  const folders = new Map<string, SavedGroup['items']>()
  for (const query of saved) {
    const slash = query.name.indexOf('/')
    const folder = slash > 0 ? query.name.slice(0, slash).trim() : ''
    const label = slash > 0 ? query.name.slice(slash + 1).trim() : query.name
    const placed = folder && label ? folder : ''
    const items = folders.get(placed) ?? []
    items.push({ query, label: placed ? label : query.name })
    folders.set(placed, items)
  }
  const named = [...folders.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  return [...(folders.has('') ? [{ folder: '', items: folders.get('')! }] : []), ...named.map(folder => ({ folder, items: folders.get(folder)! }))]
}
