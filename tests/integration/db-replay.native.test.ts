// @vitest-environment node
/**
 * Replaying migrations over a database that already has their changes.
 *
 * A database can reach an old user_version while its schema is already newer: that is what every
 * build from 0.15.0 to 0.17.1 left behind (see db-reopen.native.test.ts), and it is what a user who
 * opens an older build on a newer file produces. Opening it must end at the latest version, lose
 * nothing, and not fail on a migration that adds what is already there.
 *
 * Two parts:
 *  - a matrix over every version from 57 to the one before the latest, using whatever migrations
 *    the tree has, so a new migration is covered the day it is added;
 *  - the thread_settings migration (077), which runs only once the tree contains it.
 */
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LATEST_DB_VERSION, openDatabase } from '../../electron/main/db'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

const FIRST_REPLAYED = 57

let directory = ''
let path = ''
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'oxe-replay-'))
  path = join(directory, 'oxespace.sqlite3')
})
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

const backups = (): string[] => (existsSync(join(directory, 'db-backups')) ? readdirSync(join(directory, 'db-backups')).filter(name => name.endsWith('.sqlite3')) : [])

function seedUserData(): void {
  const db = openDatabase(path)
  try {
    const shell = db.prepare('select id from shell_profiles limit 1').get() as { id: string }
    db.prepare("insert into workspaces (id, name, root_path, layout, default_shell_profile_id, theme_id) values ('ws', 'Mine', 'C:/work', 'grid', ?, 'nord')").run(shell.id)
    db.prepare("insert into tasks (id, workspace_id, title, description, created_at, updated_at) values ('t1', 'ws', 'Fix rounding', 'Cents are lost', 1760000000000, 1760000000000)").run()
    db.prepare("insert into mcp_servers (id, workspace_id, name, transport, config_json, enabled, trusted, created_at, updated_at) values ('m1', 'ws', 'github', 'stdio', '{\"command\":\"npx\"}', 1, 1, 1760000000000, 1760000000000)").run()
  } finally {
    db.close()
  }
}

function rewind(version: number): void {
  const db = new Database(path)
  try { db.pragma(`user_version = ${version}`) } finally { db.close() }
}

describe('replaying migrations on a database that already has them', () => {
  test('a genuine upgrade from below 58 still adopts the new palette once', () => {
    seedUserData()
    // Make the file look like a real version-57 database: migration 065 has not run yet.
    const genuine = new Database(path)
    genuine.exec('drop index if exists conversation_events_rev')
    genuine.exec('alter table conversation_threads drop column epoch')
    genuine.pragma('user_version = 57')
    genuine.close()

    const db = openDatabase(path)
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST_DB_VERSION)
      expect(db.prepare("select theme_id from workspaces where id = 'ws'").get()).toEqual({ theme_id: 'midnight' })
      expect(db.prepare('pragma table_info(conversation_threads)').all().map(column => (column as { name: string }).name)).toContain('epoch')
    } finally {
      db.close()
    }
    expect(backups()).toHaveLength(1)

    // The user picks a theme after the adoption: the next open must leave it alone.
    const chosen = new Database(path)
    chosen.prepare("update workspaces set theme_id = 'nord' where id = 'ws'").run()
    chosen.close()
    const again = openDatabase(path)
    try {
      expect(again.prepare("select theme_id from workspaces where id = 'ws'").get()).toEqual({ theme_id: 'nord' })
    } finally {
      again.close()
    }
    expect(backups()).toHaveLength(1)
  })

  const versions = Array.from({ length: Math.max(0, LATEST_DB_VERSION - FIRST_REPLAYED) }, (_, index) => FIRST_REPLAYED + index)

  test('the matrix covers at least one rewound version', () => {
    expect(versions.length).toBeGreaterThan(0)
  })

  test.each(versions)('rewound to version %i, reopening ends at the latest version with the data intact', version => {
    seedUserData()
    rewind(version)

    const db = openDatabase(path)
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST_DB_VERSION)
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(db.pragma('foreign_key_check')).toEqual([])
      expect(db.prepare("select title, description from tasks where id = 't1'").get()).toEqual({ title: 'Fix rounding', description: 'Cents are lost' })
      expect(db.prepare("select name, enabled, trusted from mcp_servers where id = 'm1'").get()).toEqual({ name: 'github', enabled: 1, trusted: 1 })
      const workspace = db.prepare("select name, theme_id from workspaces where id = 'ws'").get() as { name: string; theme_id: string }
      expect(workspace.name).toBe('Mine')
      // Migration 058 resets every theme once, but only for a genuine upgrade from below 58. A database
      // that merely lost its version number has already had it, so the user's choice must survive.
      expect(workspace.theme_id, `theme after reopening from ${version}`).toBe('nord')
    } finally {
      db.close()
    }
    // A genuine upgrade takes its verified backup, and the reopen after it does nothing.
    expect(backups()).toHaveLength(1)
    openDatabase(path).close()
    expect(backups()).toHaveLength(1)
  }, 30_000)
})

// The migration that adds thread_settings. It is not in every tree yet: the block runs when the tree
// has it (user_version 77 or higher) and is skipped before that.
describe.skipIf(LATEST_DB_VERSION < 77)('thread_settings (migration 077)', () => {
  const columns = (db: Database.Database): Array<{ name: string; type: string; notnull: number; pk: number }> =>
    db.prepare('pragma table_info(thread_settings)').all() as Array<{ name: string; type: string; notnull: number; pk: number }>

  test('a database without the table is upgraded: table created with the agreed columns, one backup', () => {
    seedUserData()
    const stripped = new Database(path)
    stripped.exec('drop table thread_settings')
    stripped.pragma('user_version = 76')
    stripped.close()

    const db = openDatabase(path)
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST_DB_VERSION)
      expect(columns(db)).toEqual([
        { cid: 0, name: 'key', type: 'TEXT', notnull: 0, dflt_value: null, pk: 1 },
        { cid: 1, name: 'value', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
        { cid: 2, name: 'updated_at', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 }
      ].map(column => expect.objectContaining({ name: column.name, type: column.type, notnull: column.notnull, pk: column.pk })))
      expect((db.prepare('select count(*) as n from thread_settings').get() as { n: number }).n).toBe(0)
      expect(db.prepare("select title from tasks where id = 't1'").get()).toEqual({ title: 'Fix rounding' })
    } finally {
      db.close()
    }
    expect(backups()).toHaveLength(1)
  })

  test('a database that already has it reopens without error and keeps auto_approve_reads untouched', () => {
    seedUserData()
    const db = new Database(path)
    db.prepare("insert into thread_settings (key, value, updated_at) values ('auto_approve_reads', '1', 1760000000123)").run()
    db.close()

    for (let open = 0; open < 3; open++) openDatabase(path).close()

    const check = new Database(path, { readonly: true })
    try {
      expect(check.prepare("select value, updated_at from thread_settings where key = 'auto_approve_reads'").get()).toEqual({ value: '1', updated_at: 1760000000123 })
      expect(check.pragma('user_version', { simple: true })).toBe(LATEST_DB_VERSION)
    } finally {
      check.close()
    }
    expect(backups()).toEqual([])
  })

  test('replaying the migration over the table and its row neither fails nor changes the row', () => {
    seedUserData()
    const db = new Database(path)
    db.prepare("insert into thread_settings (key, value, updated_at) values ('auto_approve_reads', '0', 1760000000456)").run()
    db.pragma('user_version = 76')
    db.close()

    openDatabase(path).close()

    const check = new Database(path, { readonly: true })
    try {
      expect(check.prepare("select value, updated_at from thread_settings where key = 'auto_approve_reads'").get()).toEqual({ value: '0', updated_at: 1760000000456 })
      expect(check.pragma('user_version', { simple: true })).toBe(LATEST_DB_VERSION)
    } finally {
      check.close()
    }
  })
})
