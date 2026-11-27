import type { AppDatabase } from '../../db'
import type { TerminalQuitBehavior } from '../../../../shared/types/ipc/terminal'

const KEY = 'terminal_quit_behavior'

export function isTerminalQuitBehavior(value: unknown): value is TerminalQuitBehavior {
  return value === 'detach' || value === 'kill'
}

/**
 * OXE-447 · What happens to live PTY sessions when OXESpace quits:
 * - `kill` (default): stop all active terminals (and shut down the detached PTY daemon).
 * - `detach`: leave daemon-owned PTY sessions running so they survive app restart.
 */
export function terminalQuitBehavior(db: AppDatabase): TerminalQuitBehavior {
  try {
    const row = db.prepare('SELECT value FROM thread_settings WHERE key = ?').get(KEY) as { value: string } | undefined
    return isTerminalQuitBehavior(row?.value) ? row.value : 'kill'
  } catch {
    return 'kill'
  }
}

export function setTerminalQuitBehavior(db: AppDatabase, mode: TerminalQuitBehavior): TerminalQuitBehavior {
  if (!isTerminalQuitBehavior(mode)) throw new Error('Invalid terminal quit behavior')
  db.prepare(
    'INSERT INTO thread_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  ).run(KEY, mode, Date.now())
  return mode
}
