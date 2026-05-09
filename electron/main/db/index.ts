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
  }
}

function readMigration(name: string): string {
  return readFileSync(join(__dirname, 'migrations', name), 'utf8')
}
