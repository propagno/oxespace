import { i18n } from '../i18n'
import { openActivityTarget } from '../components/Activity/openActivityTarget'
import type { AppView } from '../keyboard/keybindings'
import { announceFocus } from '../keyboard/terminalFocusActions'
import { useActivityStore, type ActivityTarget } from '../store/activity.store'
import { useTerminalStore } from '../store/terminal.store'
import { useThreadStore } from '../store/thread.store'
import { useWorkspaceStore } from '../store/workspace.store'
import { derivePaneDisplayState } from '../utils/paneDisplay'

/**
 * "Go to the next one that needs you" (OXE-128, Ctrl+Shift+U): every pane and conversation waiting for the person,
 * oldest first by when it entered the state, walked in a cycle. It only navigates; approving or answering stays
 * where it always was.
 */

/** The command bar asks the mounted host (which knows the app's view switch) to take the next step. */
export const NEXT_ATTENTION_EVENT = 'oxespace:attention-next'

export interface AttentionStop {
  target: ActivityTarget
  /** Date.now() at which it entered "needs you". */
  since: number
}

interface QueuedStop extends AttentionStop { key: string; seq: number }

function queued(): QueuedStop[] {
  const { live, waits } = useActivityStore.getState()
  const workspaces = useWorkspaceStore.getState().workspaces
  const threads = useThreadStore.getState().threads
  const stops: QueuedStop[] = []
  for (const [paneId, state] of Object.entries(live.code)) {
    const wait = waits.code[paneId]
    if (state !== 'needs-you' || !wait) continue
    // Only open workspaces: a closed one runs no agent and is never opened from here.
    const workspace = workspaces.find(candidate => candidate.panes.some(pane => pane.id === paneId))
    if (!workspace) continue
    stops.push({ key: `pane:${paneId}`, seq: wait.seq, since: wait.since, target: { type: 'pane', workspaceId: workspace.id, paneId } })
  }
  for (const [threadId, state] of Object.entries(live.thread)) {
    const wait = waits.thread[threadId]
    if (state !== 'needs-you' || !wait) continue
    const workspaceId = threads.find(thread => thread.id === threadId)?.workspaceId
    stops.push({ key: `thread:${threadId}`, seq: wait.seq, since: wait.since, target: workspaceId ? { type: 'thread', threadId, workspaceId } : { type: 'thread', threadId } })
  }
  return stops.sort((a, b) => a.since - b.since || a.seq - b.seq)
}

/** Every pane and conversation that needs the person, oldest first. */
export function attentionQueue(): AttentionStop[] {
  return queued().map(({ target, since }) => ({ target, since }))
}

function arrival(target: ActivityTarget): string {
  const say = (name: string, request: string): string => i18n.t('attention.next.arrived', { name, request, interpolation: { escapeValue: false } })
  if (target.type === 'thread') {
    const thread = useThreadStore.getState().threads.find(item => item.id === target.threadId)
    return say(thread?.title?.trim() || i18n.t('attention.next.conversation'), i18n.t('attention.next.threadRequest'))
  }
  if (target.type !== 'pane') return ''
  const workspace = useWorkspaceStore.getState().workspaces.find(item => item.id === target.workspaceId)
  const pane = workspace?.panes.find(item => item.id === target.paneId)
  const entry = useTerminalStore.getState().panes[target.paneId]
  let name = pane?.displayName?.trim() || ''
  if (!name && workspace && pane && entry) {
    name = derivePaneDisplayState({ pane, workspace, terminal: entry, profile: null, paneIndex: workspace.panes.indexOf(pane) }).title
  }
  return say(name || i18n.t('attention.next.terminal'), i18n.t('attention.next.paneRequest'))
}

/** The wait this module activated last: the next call goes to the one after it. */
let last: { key: string; seq: number } | null = null

/**
 * Activates the oldest stop on the first call and the one after the last it activated on each next call, in a cycle.
 * Returns the stop it went to, or null when nothing waits (then nothing changes).
 */
export function goToNextAttention(selectView: (view: AppView) => void): AttentionStop | null {
  const queue = queued()
  if (queue.length === 0) return null
  let index = 0
  if (last) {
    const previous = last
    const at = queue.findIndex(stop => stop.key === previous.key && stop.seq === previous.seq)
    // The last one left the state: go on with the first that started waiting after it.
    index = at >= 0 ? (at + 1) % queue.length : Math.max(0, queue.findIndex(stop => stop.seq > previous.seq))
  }
  const stop = queue[index]
  last = { key: stop.key, seq: stop.seq }
  openActivityTarget(stop.target, selectView)
  announceFocus(arrival(stop.target))
  return { target: stop.target, since: stop.since }
}
