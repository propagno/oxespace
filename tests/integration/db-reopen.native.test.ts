// @vitest-environment node
/**
 * Opening a database that is already fully migrated must change nothing.
 *
 * Regression: the guard of migration 018 also tested for `panes.model_override`, a column
 * migration 028 removes. On every open of a migrated database it re-added the column,
 * set user_version to 18 and replayed migrations up to 057. The version was left at 57,
 * so the next open took a "v57" backup and migrated again, alternating forever. Every
 * published release from 0.15.0 to 0.17.1 behaved this way, and the five-backup limit
 * meant the backup taken before an upgrade was replaced by copies of itself.
 */
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LATEST_DB_VERSION, openDatabase } from '../../electron/main/db'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

describe('reopening a migrated database', () => {
  let directory = ''
  let path = ''
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'oxe-reopen-'))
    path = join(directory, 'oxespace.sqlite3')
  })
  afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

  const backups = (): string[] => (existsSync(join(directory, 'db-backups')) ? readdirSync(join(directory, 'db-backups')) : [])
  const versionAtRest = (): number => {
    const db = new Database(path, { readonly: true })
    try { return db.pragma('user_version', { simple: true }) as number } finally { db.close() }
  }

  test('keeps the latest version on every open and takes no backup', () => {
    for (let open = 1; open <= 6; open++) {
      const db = openDatabase(path)
      expect(db.pragma('user_version', { simple: true }), `open ${open}`).toBe(LATEST_DB_VERSION)
      db.close()
      expect(versionAtRest(), `at rest after open ${open}`).toBe(LATEST_DB_VERSION)
    }
    expect(backups()).toEqual([])
  })

  test('does not bring back the column migration 028 removed', () => {
    openDatabase(path).close()
    const db = openDatabase(path)
    try {
      const columns = (db.prepare('pragma table_info(panes)').all() as Array<{ name: string }>).map(c => c.name)
      expect(columns).not.toContain('model_override')
    } finally {
      db.close()
    }
  })

  test('keeps user data untouched across repeated opens', () => {
    const db = openDatabase(path)
    const shell = db.prepare('select id from shell_profiles limit 1').get() as { id: string }
    db.prepare("insert into workspaces (id, name, root_path, layout, default_shell_profile_id, theme_id) values ('ws', 'Mine', 'C:\work', 'grid', ?, 'nord')").run(shell.id)
    db.close()
    for (let open = 0; open < 4; open++) openDatabase(path).close()
    const check = new Database(path, { readonly: true })
    try {
      expect(check.prepare("select name, theme_id from workspaces where id = 'ws'").get()).toEqual({ name: 'Mine', theme_id: 'nord' })
    } finally {
      check.close()
    }
  })

  test('heals a database the old defect left at 57 with the schema already at the latest version', () => {
    openDatabase(path).close()
    const damaged = new Database(path)
    damaged.pragma('user_version = 57')
    damaged.close()

    const db = openDatabase(path)
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST_DB_VERSION)
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally {
      db.close()
    }
    // That one open is a genuine upgrade from 57 and takes its verified backup; the next ones do not.
    expect(backups()).toHaveLength(1)
    openDatabase(path).close()
    openDatabase(path).close()
    expect(backups()).toHaveLength(1)
    expect(versionAtRest()).toBe(LATEST_DB_VERSION)
  })
})
