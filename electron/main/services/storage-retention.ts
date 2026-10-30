import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const DAY_MS = 24 * 60 * 60 * 1000
/** Pre-migration database copies are for a failed upgrade: the newest few stay, older ones go after this long. */
export const BACKUP_KEEP_NEWEST = 2
export const BACKUP_MAX_AGE_DAYS = 14
/** Copies the app itself made while recovering a damaged database; nothing reads them after the recovery. */
export const RECOVERY_COPY_MAX_AGE_DAYS = 14
/** Local crash dumps (about 40 MB each) are for the developer to attach to a report; old ones are noise. */
export const CRASH_DUMP_MAX_AGE_DAYS = 7

export interface StorageRetentionResult { removed: string[]; freedBytes: number }

function files(dir: string, match: RegExp): Array<{ path: string; name: string; size: number; modified: number }> {
  let names: string[]
  try { names = readdirSync(dir) } catch { return [] }
  const found: Array<{ path: string; name: string; size: number; modified: number }> = []
  for (const name of names) {
    if (!match.test(name)) continue
    try {
      const path = join(dir, name), stat = statSync(path)
      if (stat.isFile()) found.push({ path, name, size: stat.size, modified: stat.mtimeMs })
    } catch { /* gone or locked */ }
  }
  return found
}

/**
 * Disk the app left behind that nothing reads any more: old pre-migration database copies, the copy a
 * recovery made of a damaged database, and old local crash dumps. Best effort; a file that cannot be removed
 * (locked, permissions) is left for the next start. Never touches the live database or its WAL.
 */
export function pruneStorage(userData: string, now = Date.now()): StorageRetentionResult {
  const result: StorageRetentionResult = { removed: [], freedBytes: 0 }
  const remove = (file: { path: string; size: number }): void => {
    try { unlinkSync(file.path); result.removed.push(file.path); result.freedBytes += file.size } catch { /* retried next start */ }
  }

  // Newest first by modification time; the newest copies stay whatever their age.
  const backups = files(join(userData, 'db-backups'), /^oxespace-v\d+-.*\.sqlite3$/).sort((a, b) => b.modified - a.modified)
  for (const backup of backups.slice(BACKUP_KEEP_NEWEST)) if (now - backup.modified > BACKUP_MAX_AGE_DAYS * DAY_MS) remove(backup)

  for (const copy of files(userData, /^oxespace\.sqlite3\.pre-recovery-.*\.bak$/)) if (now - copy.modified > RECOVERY_COPY_MAX_AGE_DAYS * DAY_MS) remove(copy)

  for (const dump of files(join(userData, 'Crashpad', 'reports'), /\.dmp$/i)) if (now - dump.modified > CRASH_DUMP_MAX_AGE_DAYS * DAY_MS) remove(dump)

  return result
}

/** Runs `pruneStorage` once, a minute after start, so it never competes with the first paint. */
export function scheduleStorageRetention(userData: string, delayMs = 60_000): void {
  setTimeout(() => {
    try {
      const { removed, freedBytes } = pruneStorage(userData)
      if (removed.length) console.log(`[storage] removed ${removed.length} stale file(s), ${Math.round(freedBytes / 1048576)} MB`)
    } catch { /* housekeeping only; the next start retries */ }
  }, delayMs).unref()
}
