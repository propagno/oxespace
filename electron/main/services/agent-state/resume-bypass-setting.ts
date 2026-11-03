import type { AppDatabase } from '../../db'

/**
 * T54 · Whether a resumed Claude session that started with its permission prompts skipped (`bypassPermissions`) starts
 * that way again. The mode itself comes from the session's own hook, which any process in the pane can send, so it is
 * not trusted on its own (TECH LEAD's rule on #552): only this setting, which the person changes in Settings › Terminal
 * through the window and no hook can write, lets it come back. Off by default; a row that cannot be read is off.
 */
const KEY = 'resume_bypass_permissions'

export function resumeBypassAllowed(db: AppDatabase): boolean {
  try {
    const row = db.prepare('SELECT value FROM thread_settings WHERE key = ?').get(KEY) as { value: string } | undefined
    return row?.value === '1'
  } catch { return false }
}

export function setResumeBypassAllowed(db: AppDatabase, enabled: boolean): boolean {
  db.prepare('INSERT INTO thread_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(KEY, enabled ? '1' : '0', Date.now())
  return enabled
}
