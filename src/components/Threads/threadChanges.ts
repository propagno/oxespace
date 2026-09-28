import type { ThreadEvent, ThreadFileChange } from '../../../shared/types/thread'

export interface ThreadChangeEntry { key: string; toolId: string; file: ThreadFileChange }
export function threadChanges(events: ThreadEvent[]): ThreadChangeEntry[] {
  return events.flatMap(event => event.type === 'tool' || event.type === 'turn-diff' ? (event.files ?? []).map((file, index) => ({ key: `${event.id}:${index}`, toolId: event.id, file })) : [])
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
