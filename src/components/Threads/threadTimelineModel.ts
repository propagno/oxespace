import type { ThreadEvent, ThreadRequest } from '../../../shared/types/thread'
import { groupThreadEvents } from './ThreadActivityGroup'
import type { ThreadViewMode } from '../../store/thread-view-mode.store'

/**
 * The intermediate work of a finished turn, shown as one row ("Completed 7 steps in 1m 3s") in place of the
 * rows it stands for; expanded, it is followed by those rows again.
 */
export interface ThreadTurnFold { type: 'turn-fold'; id: string; steps: number; expanded: boolean }

type ActivityGroup = ReturnType<typeof groupThreadEvents>[number] | ThreadTurnFold

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

const HIDDEN_EVENTS = new Set<ThreadEvent['type']>(['session', 'native-signal', 'context-usage', 'turn-cost', 'activity', 'configuration', 'approval-resolved', 'request-resolved', 'queue', 'delta', 'model-picker', 'cli-command', 'turn-diff', 'failure-details'])

function rowKey(turnId: string, event: ActivityGroup, ordinal: number): string {
  if (event.type === 'activity-group') return `${turnId}:activity:${event.id}`
  if ('id' in event && typeof event.id === 'string') return `${turnId}:${event.type}:${event.id}`
  return `${turnId}:${event.type}:${ordinal}`
}

function splitTurns(events: ThreadEvent[]): Array<{ id: string; events: ThreadEvent[] }> {
  const turns: Array<{ id: string; events: ThreadEvent[] }> = []
  for (const event of events) {
    if (HIDDEN_EVENTS.has(event.type) && event.type !== 'turn-diff') continue
    // Background shell commands are listed in the Background activity panel; as cards they split the reply.
    if (event.type === 'subagent' && event.action === 'Background command') continue
    if (event.type === 'message' && event.role === 'user') turns.push({ id: event.id, events: [] })
    if (!turns.length) turns.push({ id: 'initial', events: [] })
    turns[turns.length - 1].events.push(event)
  }
  return turns
}

function buildTurn(turn: { id: string; events: ThreadEvent[] }, mode: ThreadViewMode): ThreadTimelineTurn {
  return { ...turn, rows: groupThreadEvents(turn.events.filter(event => event.type !== 'turn-diff'), mode).map((event, ordinal) => ({ key: rowKey(turn.id, event, ordinal), event })) }
}

/** Pure projection from provider events to stable, renderable conversation rows. */
export function buildThreadTimeline(events: ThreadEvent[], mode: ThreadViewMode = 'verbose'): ThreadTimelineTurn[] {
  return splitTurns(events).map(turn => buildTurn(turn, mode))
}

const sameEvents = (a: ThreadEvent[], b: ThreadEvent[]): boolean => a.length === b.length && a.every((event, index) => event === b[index])

/**
 * buildThreadTimeline that only rebuilds the turns whose events changed, returning the previous turn object
 * for the others. A streamed delta keeps every earlier event object (store/threadDelta.ts), so an append
 * rebuilds the last turn only, and unchanged turns keep their identity for the steps below
 * (foldFinishedTurns, flattenThreadTimeline). A full reread brings new objects and rebuilds everything,
 * which is what buildThreadTimeline does anyway.
 */
export function createThreadTimelineBuilder(): (events: ThreadEvent[], mode?: ThreadViewMode) => ThreadTimelineTurn[] {
  let previous: { mode: ThreadViewMode; byId: Map<string, ThreadTimelineTurn> } | undefined
  return (events, mode = 'verbose') => {
    const reusable = previous?.mode === mode ? previous.byId : undefined
    const turns = splitTurns(events).map(turn => {
      const prior = reusable?.get(turn.id)
      return prior && sameEvents(prior.events, turn.events) ? prior : buildTurn(turn, mode)
    })
    previous = { mode, byId: new Map(turns.map(turn => [turn.id, turn])) }
    return turns
  }
}

export interface ThreadEventSummary {
  lastResult?: Extract<ThreadEvent, { type: 'completed' }>
  lastMessage?: Extract<ThreadEvent, { type: 'message' }>
  lastPrompt?: Extract<ThreadEvent, { type: 'message' }>
  /** Pending requests in event order. */
  pendingRequests: ThreadRequest[]
}

/** The values the conversation view reads from its events on every render, in one pass per events array. */
export function summarizeThreadEvents(events: ThreadEvent[]): ThreadEventSummary {
  const summary: ThreadEventSummary = { pendingRequests: [] }
  for (const event of events) {
    if (event.type === 'completed') summary.lastResult = event
    else if (event.type === 'message') {
      summary.lastMessage = event
      if (event.role === 'user') summary.lastPrompt = event
    } else if (event.type === 'request' && event.request.state === 'pending') summary.pendingRequests.push(event.request)
  }
  return summary
}

/** Rows a fold never hides: what was asked, the answer, and anything that still needs the person. */
function staysVisible(row: ThreadTimelineRow, finalAnswerKey: string | undefined): boolean {
  const event = row.event
  if (event.type === 'message') return event.role === 'user' || row.key === finalAnswerKey
  return event.type === 'completed' || event.type === 'turn-fold'
}

/** Counts the steps a fold stands for: each action inside a group, otherwise one per row. */
function stepCount(rows: ThreadTimelineRow[]): number {
  // A thought is not a step: "Completed 3 steps" counts what the agent did.
  return rows.reduce((sum, row) => sum + (row.event.type === 'activity-group' ? row.event.events.length : row.event.type === 'reasoning' ? 0 : 1), 0)
}

/**
 * Folds the intermediate rows of finished turns, so a long conversation reads as questions and answers.
 * A turn folds only when it completed successfully, has at least two intermediate rows, and no unresolved
 * request; failures, interruptions and the running turn stay open. `expanded` lists the turns the person opened.
 */
export function foldFinishedTurns(turns: ThreadTimelineTurn[], expanded: ReadonlySet<string>, unresolvedRequestIds: ReadonlySet<string> = new Set()): ThreadTimelineTurn[] {
  return turns.map(turn => {
    const completed = turn.events.find((event): event is Extract<ThreadEvent, { type: 'completed' }> => event.type === 'completed')
    if (completed?.status !== 'completed') return turn
    if (turn.events.some(event => event.type === 'request' && unresolvedRequestIds.has(event.request.id))) return turn
    const open = expanded.has(turn.id)
    // Turn objects are immutable; one the builder reused folds the same way as before.
    const cached = foldCache.get(turn)
    if (cached?.open === open) return cached.folded
    const folded = foldTurn(turn, open)
    foldCache.set(turn, { open, folded })
    return folded
  })
}

const foldCache = new WeakMap<ThreadTimelineTurn, { open: boolean; folded: ThreadTimelineTurn }>()

function foldTurn(turn: ThreadTimelineTurn, open: boolean): ThreadTimelineTurn {
  const answers = turn.rows.filter(row => row.event.type === 'message' && row.event.role === 'assistant')
  const finalAnswerKey = answers.at(-1)?.key
  const hidden = turn.rows.filter(row => !staysVisible(row, finalAnswerKey))
  if (hidden.length < 2) return turn
  const fold: ThreadTimelineRow = { key: `${turn.id}:turn-fold`, event: { type: 'turn-fold', id: turn.id, steps: stepCount(hidden), expanded: open } }
  // The fold sits where the work started: after the prompt, before the first hidden row.
  const firstHidden = turn.rows.indexOf(hidden[0])
  const rows = open
    ? [...turn.rows.slice(0, firstHidden), fold, ...turn.rows.slice(firstHidden)]
    : [...turn.rows.slice(0, firstHidden), fold, ...turn.rows.slice(firstHidden).filter(row => staysVisible(row, finalAnswerKey))]
  return { ...turn, rows }
}

/** Flat semantic rows are the unit mounted by the virtual timeline. */
export function flattenThreadTimeline(turns: ThreadTimelineTurn[]): ThreadTimelineItem[] {
  return turns.flatMap(turn => {
    let items = flatCache.get(turn)
    if (!items) {
      items = turn.rows.map((row, index) => ({
        ...row,
        turnId: turn.id,
        turnEvents: turn.events,
        firstInTurn: index === 0,
        lastInTurn: index === turn.rows.length - 1
      }))
      flatCache.set(turn, items)
    }
    return items
  })
}

const flatCache = new WeakMap<ThreadTimelineTurn, ThreadTimelineItem[]>()
