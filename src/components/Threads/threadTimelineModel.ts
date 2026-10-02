import type { ThreadEvent } from '../../../shared/types/thread'
import { groupThreadEvents } from './ThreadActivityGroup'

type ActivityGroup = ReturnType<typeof groupThreadEvents>[number]

export interface ThreadTimelineRow {
  key: string
  event: ActivityGroup
}

export interface ThreadTimelineTurn {
  id: string
  events: ThreadEvent[]
  rows: ThreadTimelineRow[]
}

export interface ThreadTimelineItem extends ThreadTimelineRow {
  turnId: string
  turnEvents: ThreadEvent[]
  firstInTurn: boolean
  lastInTurn: boolean
}

const HIDDEN_EVENTS = new Set<ThreadEvent['type']>(['session', 'native-signal', 'activity', 'configuration', 'approval-resolved', 'request-resolved', 'queue', 'delta', 'model-picker', 'cli-command', 'turn-diff', 'failure-details'])

function rowKey(turnId: string, event: ActivityGroup, ordinal: number): string {
  if (event.type === 'activity-group') return `${turnId}:activity:${event.id}`
  if ('id' in event && typeof event.id === 'string') return `${turnId}:${event.type}:${event.id}`
  return `${turnId}:${event.type}:${ordinal}`
}

/** Pure projection from provider events to stable, renderable conversation rows. */
export function buildThreadTimeline(events: ThreadEvent[]): ThreadTimelineTurn[] {
  const turns: Array<{ id: string; events: ThreadEvent[] }> = []
  for (const event of events) {
    if (HIDDEN_EVENTS.has(event.type) && event.type !== 'turn-diff') continue
    if (event.type === 'message' && event.role === 'user') turns.push({ id: event.id, events: [] })
    if (!turns.length) turns.push({ id: 'initial', events: [] })
    turns[turns.length - 1].events.push(event)
  }
  return turns.map(turn => ({
    ...turn,
    rows: groupThreadEvents(turn.events.filter(event => event.type !== 'turn-diff')).map((event, ordinal) => ({ key: rowKey(turn.id, event, ordinal), event }))
  }))
}

/** Flat semantic rows are the unit mounted by the virtual timeline. */
export function flattenThreadTimeline(turns: ThreadTimelineTurn[]): ThreadTimelineItem[] {
  return turns.flatMap(turn => turn.rows.map((row, index) => ({
    ...row,
    turnId: turn.id,
    turnEvents: turn.events,
    firstInTurn: index === 0,
    lastInTurn: index === turn.rows.length - 1
  })))
}
