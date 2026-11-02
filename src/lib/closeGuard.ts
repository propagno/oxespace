import type { CloseAnswer, CloseRequest } from '../../shared/types/app'
import { unsavedWork } from './unsavedWork'

/**
 * F26, nothing lost on close. Main holds a close or a quit and asks the window first (app:close-requested). With
 * nothing unsaved the answer is `proceed` at once. Otherwise the window answers `hold` straight away (main allows 3 s
 * for the first answer and then closes anyway), and the dialog that lists what would be lost gives the final answer.
 * A close that became a quit keeps its requestId, so the dialog just reads the reason it was opened with.
 */
let pendingId: string | null = null

async function answer(requestId: string, value: CloseAnswer): Promise<void> {
  try { await window.oxe?.app?.answerClose?.({ requestId, answer: value }) } catch { /* Main closes on its own after the deadline. */ }
}

export async function handleCloseRequest(request: CloseRequest): Promise<void> {
  // One dialog at a time; main reuses the pending request instead of sending another.
  if (pendingId === request.requestId) return
  if (!unsavedWork().length) { await answer(request.requestId, 'proceed'); return }
  pendingId = request.requestId
  await answer(request.requestId, 'hold')
  let decision: CloseAnswer
  try {
    const { askAboutUnsavedWork } = await import('../components/CloseGuard/UnsavedWorkDialog')
    decision = await askAboutUnsavedWork(request.reason)
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
