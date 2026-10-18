import type { ThreadTimelineItem } from './threadTimelineModel'

/** The searchable text of one timeline row: what the person can read in it. */
export function rowSearchText(row: Pick<ThreadTimelineItem, 'event'>): string {
  const event = row.event
  if (event.type === 'activity-group') return event.events.map(tool => `${tool.name} ${tool.detail ?? ''}`).join('\n')
  switch (event.type) {
    case 'message': return event.text
    case 'tool': return `${event.name} ${event.detail ?? ''}`
    case 'plan': return [event.explanation ?? '', ...event.steps.map(step => step.label)].join('\n')
    case 'request': return [event.request.title, event.request.detail ?? '', event.request.command ?? ''].join('\n')
    case 'approval': return `${event.title}\n${event.detail}`
    case 'completed': return event.failure ? `${event.failure.message}\n${event.failure.detail ?? ''}` : event.error ?? ''
    default: return ''
  }
}

/** Indexes of the rows that contain the query, case-insensitively, in timeline order. */
export function findRows(rows: Pick<ThreadTimelineItem, 'event'>[], query: string): number[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  return rows.flatMap((row, index) => rowSearchText(row).toLocaleLowerCase().includes(needle) ? [index] : [])
}

/** Text ranges of every occurrence of the query inside a rendered row, for CSS highlights. */
export function textRanges(root: Element, query: string): Range[] {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  const ranges: Range[] = []
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node && ranges.length < 200; node = walker.nextNode()) {
    const text = (node.nodeValue ?? '').toLocaleLowerCase()
    for (let at = text.indexOf(needle); at >= 0 && ranges.length < 200; at = text.indexOf(needle, at + needle.length)) {
      const range = root.ownerDocument.createRange()
      range.setStart(node, at); range.setEnd(node, at + needle.length)
      ranges.push(range)
    }
  }
  return ranges
}
