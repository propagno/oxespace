import Database from 'better-sqlite3'
import type { Database as DatabaseHandle } from 'better-sqlite3'
import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Highest migration's user_version — bump when adding a migration. Drives the
 *  pre-migration backup (only back up when an upgrade will actually run).
 *  Exported so the migrations test can catch a constant that drifts from the
 *  version the SQL actually sets. */
export const LATEST_DB_VERSION = 45
/** How many pre-migration backups to retain. */
const MAX_DB_BACKUPS = 5

export type AppDatabase = DatabaseHandle

export function resolveAppDatabasePath(): string {
  if (process.env.OXESPACE_DB_PATH) return process.env.OXESPACE_DB_PATH
  return join(app.getPath('userData'), 'oxespace.sqlite3')
}

/** Retry the open on TRANSIENT errors (a stale instance or antivirus briefly
 *  locking the file during an upgrade surfaces as SQLITE_IOERR/BUSY). Without
 *  this, a one-off lock permanently dropped the app into "native runtime
 *  unavailable" for the whole session. Real errors (ABI mismatch, corruption)
 *  are NOT retried — they fail fast so the user sees the actual cause. */
const OPEN_MAX_ATTEMPTS = 5
const OPEN_RETRY_BASE_MS = 150

export function openDatabase(databasePath = resolveAppDatabasePath()): AppDatabase {
  mkdirSync(dirname(databasePath), { recursive: true })
  let lastErr: unknown
  for (let attempt = 1; attempt <= OPEN_MAX_ATTEMPTS; attempt++) {
    try {
      return openAndMigrate(databasePath)
    } catch (err) {
      lastErr = err
      if (!isTransientDbError(err)) break // corruption/ABI — retrying won't help
      if (attempt < OPEN_MAX_ATTEMPTS) {
        // eslint-disable-next-line no-console
        console.warn(`[db] open attempt ${attempt}/${OPEN_MAX_ATTEMPTS} failed (${dbErrLabel(err)}); retrying…`)
        sleepSync(OPEN_RETRY_BASE_MS * attempt)
      }
    }
  }
  // Last resort: a wedged/corrupt -wal or -shm sidecar can keep the DB from
  // opening. Move them aside (to .bak, recoverable) and try once more.
  if (isTransientDbError(lastErr) && quarantineWalSidecars(databasePath)) {
    try { return openAndMigrate(databasePath) } catch (err) { lastErr = err }
  }
  throw lastErr
}

function openAndMigrate(databasePath: string): AppDatabase {
  const db = new Database(databasePath)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    // Back up before an upgrade so a bad migration or corruption can't silently
    // lose every workspace. Only when an existing DB is actually behind.
    const fromVersion = db.pragma('user_version', { simple: true }) as number
    if (fromVersion > 0 && fromVersion < LATEST_DB_VERSION) {
      backupBeforeMigration(db, databasePath, fromVersion)
    }
    runMigrations(db)
    return db
  } catch (err) {
    try { db.close() } catch { /* ignore */ }
    throw err
  }
}

function isTransientDbError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code ?? ''
  const msg = (err as Error | null)?.message ?? ''
  return /SQLITE_IOERR|SQLITE_BUSY|SQLITE_LOCKED|SQLITE_PROTOCOL/.test(code) ||
    /disk i\/o error|database is locked/i.test(msg)
}

function dbErrLabel(err: unknown): string {
  return (err as { code?: string } | null)?.code || (err as Error | null)?.message || 'unknown'
}

/** Brief synchronous sleep (startup-only) so a transient lock can clear. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** Move the -wal/-shm sidecars to .bak so a wedged WAL can't block the open.
 *  Uncheckpointed WAL changes would be lost, but at this point the app is
 *  otherwise unusable; the .bak keeps them recoverable. Returns true if moved. */
function quarantineWalSidecars(databasePath: string): boolean {
  let moved = false
  const stamp = Date.now()
  for (const suffix of ['-wal', '-shm']) {
    const p = databasePath + suffix
    try {
      if (existsSync(p)) { renameSync(p, `${p}.corrupt-${stamp}.bak`); moved = true }
    } catch { /* ignore */ }
  }
  if (moved) {
    // eslint-disable-next-line no-console
    console.warn('[db] quarantined WAL sidecars (.bak) after repeated I/O errors — retrying open')
  }
  return moved
}

/**
 * Copy the SQLite file to `<userData>/db-backups/` before migrating. WAL-checkpoint
 * first so the main file is complete, then prune to the most recent N. Best-effort:
 * a failed backup logs but never blocks startup.
 */
function backupBeforeMigration(db: AppDatabase, databasePath: string, fromVersion: number): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
    const dir = join(dirname(databasePath), 'db-backups')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    copyFileSync(databasePath, join(dir, `oxespace-v${fromVersion}-${stamp}.sqlite3`))
    const backups = readdirSync(dir).filter((f) => f.startsWith('oxespace-v') && f.endsWith('.sqlite3')).sort()
    for (const stale of backups.slice(0, Math.max(0, backups.length - MAX_DB_BACKUPS))) {
      try { unlinkSync(join(dir, stale)) } catch { /* ignore */ }
    }
    // eslint-disable-next-line no-console
    console.log(`[db] backed up before migration v${fromVersion}→${LATEST_DB_VERSION}`)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[db] pre-migration backup failed (continuing):', err instanceof Error ? err.message : err)
  }
}

export function openInMemoryDatabase(): AppDatabase {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

export function runMigrations(db: AppDatabase): void {
  let currentVersion = db.pragma('user_version', { simple: true }) as number

  if (currentVersion < 1) {
    db.exec(readMigration('001_initial.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 2) {
    db.exec(readMigration('002_shell_profiles.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 3) {
    db.exec(readMigration('003_agents.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 4) {
    db.exec(readMigration('004_tasks.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 5) {
    db.exec(readMigration('005_agent_shell_settings.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 6) {
    db.exec(readMigration('006_workspace_editor_state.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 7) {
    db.exec(readMigration('007_workspace_customization.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 8) {
    db.exec(readMigration('008_workspace_oxe_state.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 9) {
    db.exec(readMigration('009_agent_workflows.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 10) {
    db.exec(readMigration('010_copilot_shell_profile.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 11) {
    db.exec(readMigration('011_pane_agent.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 12) {
    db.exec(readMigration('012_pane_display_name.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 13) {
    db.exec(readMigration('013_workspace_review_state.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 14) {
    db.exec(readMigration('014_agent_skills.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 15) {
    db.exec(readMigration('015_github_tools.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 18 || !hasColumn(db, 'panes', 'model_override')) {
    if (!hasColumn(db, 'panes', 'model_override')) {
      db.exec(readMigration('018_pane_model_override.sql'))
    } else {
      db.pragma('user_version = 18')
    }
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 19 || !hasColumn(db, 'panes', 'root_path')) {
    if (!hasColumn(db, 'panes', 'root_path')) {
      db.exec(readMigration('019_pane_root_path.sql'))
    } else {
      db.pragma('user_version = 19')
    }
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 20) {
    db.exec(readMigration('020_more_providers.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 21 || !hasTable(db, 'background_jobs')) {
    db.exec(readMigration('021_background_jobs.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 22 || !hasTable(db, 'session_forks')) {
    db.exec(readMigration('022_session_forks.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 23 || !hasTable(db, 'task_dependencies')) {
    db.exec(readMigration('023_task_dependencies.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 24 || !hasTable(db, 'mcp_servers')) {
    db.exec(readMigration('024_mcp_servers.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 25) {
    db.exec(readMigration('025_drop_legacy_pane_types.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 26 || !hasColumn(db, 'mcp_servers', 'trusted')) {
    if (!hasColumn(db, 'mcp_servers', 'trusted')) {
      db.exec(readMigration('026_mcp_trust.sql'))
    } else {
      db.pragma('user_version = 26')
    }
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 27) {
    db.exec(readMigration('027_dracula_default.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 28 || hasColumn(db, 'panes', 'model_override')) {
    // SQLite's ALTER TABLE DROP COLUMN errors when the column is missing —
    // older installs may already be missing it, so we guard each drop with
    // hasColumn instead of relying on the .sql file (which only bumps the
    // user_version).
    if (hasColumn(db, 'panes', 'model_override')) {
      db.exec(`ALTER TABLE panes DROP COLUMN model_override`)
    }
    db.exec(readMigration('028_drop_pane_model_override.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 29 || hasTable(db, 'agent_workflow_runs') || hasColumn(db, 'workspaces', 'agents_panel_visible')) {
    // Tables drop with IF EXISTS (idempotent) inside the .sql file.
    // Columns are dropped here, one by one, only when present — older installs
    // hit "no such column: agents_panel_visible" otherwise.
    db.exec(readMigration('029_remove_plan_exec.sql'))
    for (const col of ['agents_panel_visible', 'agents_panel_expanded', 'agents_panel_width_percent']) {
      if (hasColumn(db, 'workspaces', col)) {
        db.exec(`ALTER TABLE workspaces DROP COLUMN ${col}`)
      }
    }
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 30 || !hasColumn(db, 'workspaces', 'background_panel_visible')) {
    // ADD COLUMN is not idempotent either — guard so a partial upgrade can
    // re-run safely.
    if (!hasColumn(db, 'workspaces', 'background_panel_visible')) {
      db.exec(readMigration('030_workspace_background_panel.sql'))
    } else {
      db.pragma('user_version = 30')
    }
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 31) {
    db.exec(readMigration('031_powershell_shell_profile.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 32 || !hasTable(db, 'integration_groups')) {
    db.exec(readMigration('032_integration_groups.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 33 || !hasColumn(db, 'workspaces', 'worktree_panel_visible')) {
    // ADD COLUMN is not idempotent — guard so partial upgrades can re-run safely.
    if (!hasColumn(db, 'workspaces', 'worktree_panel_visible')) {
      db.exec(readMigration('033_workspace_worktree_panel.sql'))
    } else {
      db.pragma('user_version = 33')
    }
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 34 || !hasColumn(db, 'workspaces', 'sort_order')) {
    if (!hasColumn(db, 'workspaces', 'sort_order')) {
      db.exec(readMigration('034_workspace_sort_order.sql'))
    } else {
      db.pragma('user_version = 34')
    }
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 35 || !hasTable(db, 'internal_mcp_meta')) {
    db.exec(readMigration('035_internal_mcp_meta.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 36) {
    db.exec(readMigration('036_compact_background_panel.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 37) {
    db.exec(readMigration('037_change_gemini_to_antigravity.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 38) {
    db.exec(readMigration('038_force_antigravity_command_agy.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  // Guard on the table too: the embeddings table is required for the Semantic
  // search service, and a partial upgrade (version bumped but table missing)
  // would otherwise leave the service permanently broken.
  if (currentVersion < 39 || !hasTable(db, 'semantic_embeddings')) {
    db.exec(readMigration('039_semantic_embeddings.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  // 040: binary Float32 embedding storage (additive columns). Idempotent + atomic:
  // a prior PARTIAL apply (columns added but user_version not bumped — e.g. a crash
  // or disk-I/O between the ALTERs and the PRAGMA) otherwise wedges every future
  // boot with "duplicate column name: embedding_blob". Add each column only when
  // missing and bump the version in ONE transaction so it can't half-apply again.
  if (currentVersion < 40 || !hasColumn(db, 'semantic_embeddings', 'embedding_blob') || !hasColumn(db, 'semantic_embeddings', 'dim')) {
    db.transaction(() => {
      if (!hasColumn(db, 'semantic_embeddings', 'embedding_blob')) {
        db.exec('ALTER TABLE semantic_embeddings ADD COLUMN embedding_blob BLOB')
      }
      if (!hasColumn(db, 'semantic_embeddings', 'dim')) {
        db.exec('ALTER TABLE semantic_embeddings ADD COLUMN dim INTEGER')
      }
      db.pragma('user_version = 40')
    })()
    currentVersion = 40
  }

  if (currentVersion < 41) {
    db.exec(readMigration('041_grok_cli.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 42 || !hasColumn(db, 'tasks', 'acceptance_criteria')) {
    if (!hasColumn(db, 'tasks', 'acceptance_criteria')) {
      db.exec(readMigration('042_task_acceptance_criteria.sql'))
    } else {
      db.pragma('user_version = 42')
    }
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 43 || !hasTable(db, 'semantic_documents') || !hasTable(db, 'semantic_documents_fts')) {
    db.exec(readMigration('043_semantic_lexical_index.sql'))
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 44 || !hasColumn(db, 'semantic_embeddings', 'chunk_metadata_json')) {
    if (!hasColumn(db, 'semantic_embeddings', 'chunk_metadata_json')) {
      db.exec(readMigration('044_semantic_chunk_metadata.sql'))
    } else {
      db.pragma('user_version = 44')
    }
    currentVersion = db.pragma('user_version', { simple: true }) as number
  }

  if (currentVersion < 45 || !hasTable(db, 'secure_credentials')) {
    db.exec(readMigration('045_secure_credentials.sql'))
  }
}

function readMigration(name: string): string {
  return readFileSync(join(__dirname, 'migrations', name), 'utf8')
}

// Direct introspection — no caching. (A memoized variant shipped in v0.2.6 was
// reverted: a stale/mismatched cache entry could make a guard re-run a migration
// it should have skipped. The ~1ms saved per boot isn't worth that risk.)
function hasColumn(db: AppDatabase, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>
  return columns.some((c) => c.name === column)
}

function hasTable(db: AppDatabase, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined
  return Boolean(row)
}
