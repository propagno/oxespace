import Database from 'better-sqlite3'
import type { Database as DatabaseHandle } from 'better-sqlite3'
import { app } from 'electron'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export type AppDatabase = DatabaseHandle

export function resolveAppDatabasePath(): string {
  if (process.env.OXESPACE_DB_PATH) return process.env.OXESPACE_DB_PATH
  return join(app.getPath('userData'), 'oxespace.sqlite3')
}

export function openDatabase(databasePath = resolveAppDatabasePath()): AppDatabase {
  mkdirSync(dirname(databasePath), { recursive: true })
  const db = new Database(databasePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
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
}

function readMigration(name: string): string {
  return readFileSync(join(__dirname, 'migrations', name), 'utf8')
}

function hasColumn(db: AppDatabase, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>
  return columns.some((item) => item.name === column)
}

function hasTable(db: AppDatabase, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined
  return Boolean(row)
}
