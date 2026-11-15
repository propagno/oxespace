import { openActivityTarget } from '../components/Activity/openActivityTarget'
import { i18n } from '../i18n'
import type { AppView } from '../keyboard/keybindings'
import { announceFocus } from '../keyboard/terminalFocusActions'
import { useActivityStore, type ActivityTarget } from '../store/activity.store'
import { useTerminalStore } from '../store/terminal.store'
import { useThreadStore } from '../store/thread.store'
import { useWorkspaceStore } from '../store/workspace.store'
import { derivePaneDisplayState } from '../utils/paneDisplay'

/**
 * OXE-128: Ctrl+Shift+U takes the person to the next pane or conversation that needs them, oldest first, in a cycle.
 * "Needs you" is what the attention feed counts (src/store/activity.feed.ts); when each one started waiting is kept by
 * the activity store (`waiting`). Only open workspaces count: a pane whose workspace is closed is never in the queue.
 */
export const NEXT_ATTENTION_EVENT = 'oxe:attention-next'

export interface AttentionStop {
  target: Extract<ActivityTarget, { type: 'pane' | 'thread' }>
  /** Date.now() when it entered "needs you". */
  since: number
}

interface Stop extends AttentionStop {
  key: string
  seq: number
  name: string
  request: string
}

function stops(): Stop[] {
  const { waiting } = useActivityStore.getState()
  const workspaces = useWorkspaceStore.getState().workspaces
  const panes = useTerminalStore.getState().panes
  const threads = useThreadStore.getState().threads
  const found: Stop[] = []
  for (const [paneId, wait] of Object.entries(waiting.code)) {
    const workspace = workspaces.find(candidate => candidate.panes.some(pane => pane.id === paneId))
    const entry = panes[paneId]
    if (!workspace || !entry) continue
    const paneIndex = workspace.panes.findIndex(pane => pane.id === paneId)
    const display = derivePaneDisplayState({ pane: workspace.panes[paneIndex], workspace, terminal: entry, profile: null, paneIndex })
    found.push({ key: `pane:${paneId}`, seq: wait.seq, since: wait.since, target: { type: 'pane', workspaceId: workspace.id, paneId },
      name: display.title, request: display.attentionReason ?? display.statusLabel })
  }
  for (const [threadId, wait] of Object.entries(waiting.thread)) {
    const thread = threads.find(candidate => candidate.id === threadId)
    if (!thread) continue
    found.push({ key: `thread:${threadId}`, seq: wait.seq, since: wait.since, target: { type: 'thread', threadId },
      name: thread.title?.trim() || threadId, request: i18n.t('activityCenter.threadRequest') })
  }
  return found.sort((a, b) => a.since - b.since || a.seq - b.seq)
}

/** Every pane and conversation that needs the person, oldest first. */
export function attentionQueue(): AttentionStop[] {
  return stops().map(({ target, since }) => ({ target, since }))
}

/** The wait the shortcut last went to; a new wait of the same subject is another stop. */
let last: { key: string; seq: number } | null = null

/**
 * Goes to the stop after the last one it went to, in a cycle; to the oldest the first time, or when that one no longer
 * waits. Says where it arrived in the polite live region. Null, changing nothing, when nothing waits.
 */
export function goToNextAttention(selectView: (view: AppView) => void): AttentionStop | null {
  const queue = stops()
  if (queue.length === 0) return null
  const previous = last
  const at = previous ? queue.findIndex(stop => stop.key === previous.key && stop.seq === previous.seq) : -1
  const stop = queue[at < 0 ? 0 : (at + 1) % queue.length]
  last = { key: stop.key, seq: stop.seq }
  openActivityTarget(stop.target, selectView)
  announceFocus(i18n.t('activityCenter.arrived', { name: stop.name, request: stop.request }))
  return { target: stop.target, since: stop.since }
}
