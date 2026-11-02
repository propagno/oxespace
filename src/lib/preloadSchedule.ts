/**
 * The only part of the idle preload in the boot bundle: the idle scheduler. What to preload, the most recent view,
 * the off switch and when to skip live in ./idlePreload, a chunk loaded once the window is idle.
 */

/** Runs `task` when the window is idle, or after `timeoutMs` at the latest. Returns the cancel function. */
export function scheduleIdle(task: () => void, timeoutMs = 2_000): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(() => task(), { timeout: timeoutMs })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(task, timeoutMs)
  return () => clearTimeout(id)
}
