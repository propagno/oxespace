import type { ThreadEvent, ThreadFileChange } from '../../../shared/types/thread'

export interface ThreadChangeEntry { key: string; toolId: string; file: ThreadFileChange }
export interface ThreadSessionFile { path: string; primary: ThreadChangeEntry; operations: ThreadChangeEntry[] }
export interface ThreadSessionChangeGroup { turnId: string; sequence: number; label: string; files: ThreadSessionFile[] }
export function threadChanges(events: ThreadEvent[]): ThreadChangeEntry[] {
  return events.flatMap(event => event.type === 'tool' || event.type === 'turn-diff' ? (event.files ?? []).map((file, index) => ({ key: `${event.id}:${index}`, toolId: event.id, file })) : [])
}
/** Historical operations grouped by the user turn that produced them. */
export function sessionChangeGroups(events: ThreadEvent[]): ThreadSessionChangeGroup[] {
  const groups: ThreadSessionChangeGroup[] = []
  let current: ThreadSessionChangeGroup | undefined
  for (const event of events) {
    if (event.type === 'message' && event.role === 'user') {
      current = { turnId: event.id, sequence: groups.length + 1, label: event.text.trim().split(/\r?\n/)[0].slice(0, 96) || 'User request', files: [] }
      groups.push(current)
    }
    if (event.type !== 'tool' && event.type !== 'turn-diff') continue
    if (!current) {
      current = { turnId: 'initial', sequence: 0, label: 'Earlier session activity', files: [] }
      groups.push(current)
    }
    for (const entry of threadChanges([event])) {
      const path = entry.file.path.replace(/\\/g, '/').toLowerCase()
      let file = current.files.find(value => value.path.replace(/\\/g, '/').toLowerCase() === path)
      if (!file) { file = { path: entry.file.path, primary: entry, operations: [] }; current.files.push(file) }
      file.operations.push(entry)
      // Prefer verified final evidence over a tool's proposed input. Keep every
      // operation available for inspection even when the final diff is selected.
      const rank = (candidate: ThreadChangeEntry) => candidate.file.source === 'native-patch' ? 3 : candidate.file.source === 'working-tree-observation' ? 2 : 1
      if (rank(entry) >= rank(file.primary)) file.primary = entry
    }
  }
  return groups.filter(group => group.files.length).reverse()
}
export function turnChanges(events: ThreadEvent[]): ThreadChangeEntry[] {
  const aggregates = events.filter(event => event.type === 'turn-diff')
  if (!aggregates.length) return threadChanges(events)
  const native = aggregates.filter(event => event.type === 'turn-diff' && event.id.startsWith('turn-diff:')).at(-1)
  const observed = aggregates.filter(event => event.type === 'turn-diff' && event.id.startsWith('verified-diff:')).at(-1)
  if (!native && !observed) return threadChanges(aggregates.slice(-1))
  const entries = threadChanges([...(native ? [native] : []), ...(observed ? [observed] : [])])
  const seen = new Set<string>()
  return entries.filter(entry => {
    const path = entry.file.path.replace(/\\/g, '/').toLowerCase()
    if (seen.has(path)) return false
    seen.add(path)
    return true
  })
}
export function threadFileLabel(path: string, root: string): string {
  const normalized = path.replace(/\\/g, '/'), prefix = root.replace(/\\/g, '/').replace(/\/$/, '') + '/'
  return normalized.toLowerCase().startsWith(prefix.toLowerCase()) ? normalized.slice(prefix.length) : normalized
}
/** Totals are exact only when each path has one successful, complete native patch. */
export function changeSummary(entries: ThreadChangeEntry[]) {
  const paths = new Set(entries.map(entry => entry.file.path))
  const exact = paths.size === entries.length && entries.every(({ file }) => file.source !== 'tool-input' && file.state === 'completed' && !file.truncated && file.additions !== undefined && file.deletions !== undefined)
  return { files: paths.size, operations: entries.length, exact, additions: exact ? entries.reduce((sum, entry) => sum + entry.file.additions!, 0) : undefined, deletions: exact ? entries.reduce((sum, entry) => sum + entry.file.deletions!, 0) : undefined }
}
