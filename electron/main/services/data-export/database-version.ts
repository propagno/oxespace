import Database from 'better-sqlite3'

/**
 * The version the app database had before this start migrated it; 0 when there is none or it cannot be read
 * (fileMustExist makes a missing file throw, which reads as none). OXE-358: the one thing index.ts reads of the
 * removed-features export at boot, kept apart so that exporter loads only on first use (data-export.ipc.ts).
 */
export function peekDatabaseVersion(databasePath: string): number {
  try {
    const handle = new Database(databasePath, { readonly: true, fileMustExist: true })
    try {
      const version = handle.pragma('user_version', { simple: true })
      return typeof version === 'number' ? version : 0
    } finally { handle.close() }
  } catch { return 0 }
}
