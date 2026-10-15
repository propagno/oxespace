// @vitest-environment node
/**
 * Upgrade rehearsal: a database created by the PREVIOUS STABLE release's own code is
 * filled with user data and opened by the current code.
 *
 * The previous release's `electron/main/db` is read from its git tag and run as it was
 * shipped, so the starting schema is the real one rather than a hand-built imitation.
 * Run with `npm run test:electron` (native SQLite). It is skipped when the tag is not
 * available, which CI avoids by fetching full history and tags.
 *
 * To rehearse another release: `OXESPACE_UPGRADE_FROM=v0.15.0 npm run test:electron -- tests/integration/upgrade-rehearsal.native.test.ts`
 */
import Database from 'better-sqlite3'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { LATEST_DB_VERSION, openDatabase } from '../../electron/main/db'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (t: string) => Buffer.from(t), decryptString: (v: Buffer) => v.toString() }
}))

/** Update when a release becomes the latest stable. */
const PREVIOUS_STABLE = process.env.OXESPACE_UPGRADE_FROM ?? 'v0.16.0'

function tagExists(tag: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const available = tagExists(PREVIOUS_STABLE)

type Row = Record<string, unknown>
interface Seeded { table: string; key: Row; values: Row }

/** Compares what was written before the upgrade with what the upgraded database holds. */
export function findLostData(seeded: Seeded[], upgraded: Database.Database): string[] {
  const problems: string[] = []
  for (const { table, key, values } of seeded) {
    const exists = upgraded.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(table)
    if (!exists) { problems.push(`table ${table} no longer exists`); continue }
    const columns = new Set((upgraded.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name))
    const where = Object.keys(key).map(column => `${column} = @${column}`).join(' and ')
    const row = upgraded.prepare(`select * from ${table} where ${where}`).get(key) as Row | undefined
    if (!row) { problems.push(`${table} ${JSON.stringify(key)} was deleted`); continue }
    for (const [column, expected] of Object.entries(values)) {
      if (!columns.has(column)) { problems.push(`${table}.${column} no longer exists`); continue }
      const actual = row[column]
      const same = Buffer.isBuffer(expected) ? Buffer.isBuffer(actual) && expected.equals(actual) : actual === expected
      if (!same) problems.push(`${table}.${column} changed for ${JSON.stringify(key)}`)
    }
  }
  return problems
}

describe.skipIf(!available)(`upgrading a database created by ${PREVIOUS_STABLE}`, () => {
  const mirror = resolve('tests/.upgrade-mirror', PREVIOUS_STABLE)
  let directory = ''
  let databasePath = ''
  let oldVersion = 0
  let oldTableCounts: Record<string, number> = {}
  const seeded: Seeded[] = []

  function insert(db: Database.Database, table: string, values: Row, key: Row): void {
    const columns = Object.keys(values)
    db.prepare(`insert into ${table} (${columns.join(', ')}) values (${columns.map(c => `@${c}`).join(', ')})`).run(values)
    seeded.push({ table, key, values })
  }

  beforeAll(async () => {
    rmSync(mirror, { recursive: true, force: true })
    mkdirSync(mirror, { recursive: true })
    const listing = execFileSync('git', ['ls-tree', '-r', '--name-only', PREVIOUS_STABLE, 'electron/main/db'], { encoding: 'utf8' })
    for (const file of listing.split(/\r?\n/).filter(Boolean)) {
      const target = join(mirror, file)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, execFileSync('git', ['show', `${PREVIOUS_STABLE}:${file}`], { maxBuffer: 16 * 1024 * 1024 }))
    }
    const previous = await import(/* @vite-ignore */ pathToFileURL(join(mirror, 'electron/main/db/index.ts')).href)

    directory = mkdtempSync(join(tmpdir(), 'oxe-upgrade-'))
    databasePath = join(directory, 'oxespace.sqlite3')
    const db = previous.openDatabase(databasePath) as Database.Database
    oldVersion = db.pragma('user_version', { simple: true }) as number
    const shell = db.prepare('select id from shell_profiles limit 1').get() as { id: string }

    insert(db, 'workspaces', {
      id: 'ws-1', name: 'Payments API', root_path: 'C:\\work\\payments', layout: 'grid', default_shell_profile_id: shell.id,
      theme_id: 'dracula', ui_density: 'compact', layout_preset: 4, sort_order: 3
    }, { id: 'ws-1' })
    insert(db, 'panes', {
      id: 'pane-1', workspace_id: 'ws-1', row_index: 0, column_index: 1, shell_profile_id: shell.id, display_name: 'Build agent', agent_name: 'Claude', root_path: 'C:\\work\\payments'
    }, { id: 'pane-1' })
    insert(db, 'thread_projects', {
      id: 'proj-1', identity: 'git:payments', root_path: 'C:\\work\\payments', display_name: 'Payments', hidden: 1, created_at: 1_760_000_000_000, updated_at: 1_760_000_500_000
    }, { id: 'proj-1' })
    insert(db, 'thread_project_contexts', { project_id: 'proj-1', root_path: 'C:\\work\\payments' }, { project_id: 'proj-1', root_path: 'C:\\work\\payments' })
    insert(db, 'conversation_threads', {
      id: 'thread-1', workspace_id: 'ws-1', thread_project_id: 'proj-1',
      data_json: JSON.stringify({ id: 'thread-1', title: 'Refactor ledger', provider: 'claude', pinned: true }),
      events_json: JSON.stringify([{ type: 'message', id: 'm1', role: 'user', text: 'Refactor the ledger — with “quotes”, emoji 🚀 and \\ backslashes' }]),
      history_version: 1
    }, { id: 'thread-1' })
    insert(db, 'mcp_servers', {
      id: 'mcp-1', workspace_id: 'ws-1', name: 'github', transport: 'stdio', config_json: JSON.stringify({ command: 'npx', args: ['-y', 'server'] }),
      enabled: 1, trusted: 1, created_at: 1_760_000_000_000, updated_at: 1_760_000_000_000
    }, { id: 'mcp-1' })
    insert(db, 'tasks', {
      id: 'task-1', workspace_id: 'ws-1', title: 'Fix rounding', description: 'Cents are lost', created_at: 1_760_000_000_000, updated_at: 1_760_000_000_000
    }, { id: 'task-1' })
    insert(db, 'agent_profiles', {
      agent_profile_id: 'custom-1', name: 'My reviewer', provider: 'custom', command: 'my-reviewer', command_template: 'my-reviewer {prompt}', is_builtin: 0, created_at: 1_760_000_000_000
    }, { agent_profile_id: 'custom-1' })
    insert(db, 'secure_credentials', {
      provider: 'linear', payload: Buffer.from([0, 1, 2, 250, 251, 252]), encrypted: 1, label: 'work', created_at: 1_760_000_000_000, updated_at: 1_760_000_000_000
    }, { provider: 'linear' })

    const names = (db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '%\\_fts%' escape '\\'").all() as Array<{ name: string }>).map(r => r.name)
    oldTableCounts = Object.fromEntries(names.map(name => [name, (db.prepare(`select count(*) as n from ${name}`).get() as { n: number }).n]))
    db.close()
  }, 120_000)

  afterAll(() => {
    rmSync(mirror, { recursive: true, force: true })
    if (directory) rmSync(directory, { recursive: true, force: true })
  })

  test('starts from the real previous schema', () => {
    expect(oldVersion).toBeGreaterThan(0)
    expect(oldVersion).toBeLessThan(LATEST_DB_VERSION)
  })

  test('migrates to the current version, keeps every value the user wrote and passes integrity checks', () => {
    const db = openDatabase(databasePath)
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST_DB_VERSION)
      expect(findLostData(seeded, db)).toEqual([])
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally {
      db.close()
    }
  })

  test('never loses rows from a table that had them, and never drops such a table', () => {
    const db = new Database(databasePath, { readonly: true })
    try {
      for (const [table, before] of Object.entries(oldTableCounts)) {
        if (before === 0) continue
        const exists = db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(table)
        expect(exists, `table ${table} had ${before} rows and is gone`).toBeTruthy()
        const after = (db.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n
        expect(after, `${table} lost rows`).toBeGreaterThanOrEqual(before)
      }
    } finally {
      db.close()
    }
  })

  test('took exactly one verified backup of the previous version, holding the original data', () => {
    const backups = readdirSync(join(directory, 'db-backups')).filter(name => name.endsWith('.sqlite3'))
    expect(backups).toHaveLength(1)
    expect(backups[0]).toContain(`oxespace-v${oldVersion}-`)
    expect(readdirSync(join(directory, 'db-backups')).filter(name => name.endsWith('.partial'))).toEqual([])
    const backup = new Database(join(directory, 'db-backups', backups[0]), { readonly: true })
    try {
      expect(backup.pragma('user_version', { simple: true })).toBe(oldVersion)
      expect(backup.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(findLostData(seeded, backup)).toEqual([])
    } finally {
      backup.close()
    }
  })

  test('reopening the upgraded database changes nothing and takes no second backup', () => {
    const db = openDatabase(databasePath)
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST_DB_VERSION)
      expect(findLostData(seeded, db)).toEqual([])
    } finally {
      db.close()
    }
    expect(readdirSync(join(directory, 'db-backups')).filter(name => name.endsWith('.sqlite3'))).toHaveLength(1)
  })

  test('the check itself notices a deleted row, a changed value and a removed column', () => {
    const copy = join(directory, 'tampered.sqlite3')
    const source = new Database(databasePath, { readonly: true })
    source.exec(`vacuum into '${copy.replace(/'/g, "''")}'`)
    source.close()
    const db = new Database(copy)
    try {
      db.prepare("delete from tasks where id = 'task-1'").run()
      db.prepare("update workspaces set name = 'Renamed' where id = 'ws-1'").run()
      db.prepare('drop table mcp_servers').run()
      const problems = findLostData(seeded, db)
      expect(problems).toContain('tasks {"id":"task-1"} was deleted')
      expect(problems).toContain('workspaces.name changed for {"id":"ws-1"}')
      expect(problems).toContain('table mcp_servers no longer exists')
    } finally {
      db.close()
      expect(existsSync(copy)).toBe(true)
    }
  })
})
