import type { ThreadSnapshot } from '../../../shared/types/thread'
import { useNavigationPrefs } from '../../store/navigation-prefs.store'
import { useTerminalStore } from '../../store/terminal.store'
import { useThreadStore } from '../../store/thread.store'

/**
 * Local "time to first answer": from the moment the first-run guide appears to the first agent answer, in Thread (an
 * assistant message) or in Code (an agent pane reports a finished turn). The duration stays on this computer: it is
 * kept in the navigation preferences and written to the local runtime log. Nothing is sent anywhere.
 */
export function hasAssistantAnswer(snapshot: ThreadSnapshot | null, since: number): boolean {
  // A conversation from before the guide appeared is not a first answer.
  if (!snapshot || snapshot.thread.createdAt < since) return false
  return snapshot.events.some(event => event.type === 'message' && event.role === 'assistant')
}

function pending(): boolean {
  const { startedAt, firstAnswerMs } = useNavigationPrefs.getState().firstRun
  return startedAt !== null && firstAnswerMs === null
}

let stop: (() => void) | null = null

function answered(kind: 'thread' | 'code', now = Date.now()): void {
  if (!pending()) return
  const prefs = useNavigationPrefs.getState()
  const durationMs = Math.max(0, now - prefs.firstRun.startedAt!)
  prefs.recordFirstAnswer(durationMs)
  prefs.completeFirstRunStep('folder')
  stop?.()
  void window.oxe?.diagnostics?.recordFirstAnswer?.({ durationMs, kind }).catch(() => undefined)
}

/** Starts watching for the first answer when the clock runs and no answer was seen yet. Safe to call repeatedly. */
export function watchFirstAnswer(): void {
  if (stop || !pending()) return
  const offThread = useThreadStore.subscribe((state, previous) => {
    if (state.snapshot !== previous.snapshot && hasAssistantAnswer(state.snapshot, useNavigationPrefs.getState().firstRun.startedAt ?? Infinity)) answered('thread')
  })
  const offTerminal = useTerminalStore.subscribe((state, previous) => {
    if (state.panes !== previous.panes && Object.values(state.panes).some(pane => pane.agentState === 'done')) answered('code')
  })
  stop = () => { offThread(); offTerminal(); stop = null }
}

// A clock started before a restart keeps running until the first answer.
if (typeof window !== 'undefined') watchFirstAnswer()
