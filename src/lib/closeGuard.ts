import type { CloseAnswer, CloseRequest } from '../../shared/types/app'
import { unsavedWork } from './unsavedWork'

/**
 * F26, nothing lost on close. Main holds a close or a quit and asks the window first (app:close-requested). With
 * nothing unsaved and no turn in progress the answer is `proceed`. Otherwise the window answers `hold` (main allows
 * 3 s for the first answer and then closes anyway), and the dialog that says what closing does gives the final answer.
 * A close that became a quit keeps its requestId, so the dialog just reads the reason it was opened with.
 */
let pendingId: string | null = null

/** A conversation whose agent is in the middle of a turn: closing the app stops it, and it reopens paused. */
export interface RunningTurn { id: string; title: string }

/** Main's list is asked when the close arrives; this long, and the close goes on as if nothing ran. */
export const RUNNING_TURNS_LOOKUP_MS = 1500

/**
 * Conversations with a turn in progress, working or waiting for the person. Asked of main, which knows every
 * conversation whatever this window has open. A list that fails or is late counts as nothing running: the question
 * is a courtesy, and the app must stay closable.
 */
export async function runningTurns(): Promise<RunningTurn[]> {
  const list = window.oxe?.thread?.list
  if (!list) return []
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const late = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), RUNNING_TURNS_LOOKUP_MS) })
    const threads = await Promise.race([list(), late])
    return (threads ?? []).filter(thread => thread.status === 'running' || thread.status === 'approval').map(thread => ({ id: thread.id, title: thread.title }))
  } catch {
    return []
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function answer(requestId: string, value: CloseAnswer): Promise<void> {
  try { await window.oxe?.app?.answerClose?.({ requestId, answer: value }) } catch { /* Main closes on its own after the deadline. */ }
}

export async function handleCloseRequest(request: CloseRequest): Promise<void> {
  // One dialog at a time; main reuses the pending request instead of sending another.
  if (pendingId === request.requestId) return
  pendingId = request.requestId
  // Unsaved work is known at once: hold before anything that takes time.
  const unsaved = unsavedWork().length > 0
  if (unsaved) await answer(request.requestId, 'hold')
  const running = await runningTurns()
  if (!unsaved && !running.length) { pendingId = null; await answer(request.requestId, 'proceed'); return }
  if (!unsaved) await answer(request.requestId, 'hold')
  let decision: CloseAnswer
  try {
    const { askAboutUnsavedWork } = await import('../components/CloseGuard/UnsavedWorkDialog')
    decision = await askAboutUnsavedWork(request.reason, running)
  } catch {
    // The dialog could not load: keep the window open rather than lose the work.
    decision = 'cancel'
  }
  pendingId = null
  await answer(request.requestId, decision)
}

/** Subscribes once, at start: a window that has not subscribed gets main's 3 s deadline and a forced close. */
export function installCloseGuard(): () => void {
  const unsubscribe = window.oxe?.app?.onCloseRequested?.(request => { void handleCloseRequest(request) })
  return () => { unsubscribe?.(); pendingId = null }
}
