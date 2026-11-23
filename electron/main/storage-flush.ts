/**
 * OXE-396: Chromium writes the window's localStorage to disk a few seconds after a change. A process that ended before
 * then (an abort on quit, OXE-392, and sometimes a plain quit) lost everything written since: the side-by-side view, the
 * start view, the panel and sidebar choices. The quit drain in index.ts calls this first, with its other work, so every
 * normal quit (the window's close, app quit, a relaunch) writes it out and waits a short grace for it to land.
 *
 * `flushStorageData()` only asks: it returns nothing and settles nothing. So the wait is a fixed, short grace, the one
 * bound on what this adds to a quit, and a session that throws or is missing never holds the quit.
 */
export const STORAGE_FLUSH_GRACE_MS = 200

export interface FlushableSession { flushStorageData(): void }

export async function flushStorage(session: FlushableSession | null | undefined, graceMs = STORAGE_FLUSH_GRACE_MS): Promise<void> {
  try { session?.flushStorageData() } catch { /* the quit goes on regardless */ }
  await new Promise<void>(resolve => { setTimeout(resolve, graceMs) })
}
