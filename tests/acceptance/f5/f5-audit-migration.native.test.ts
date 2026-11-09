// Frozen acceptance test for 1.5.0 F5 (OXE program), TECH LEAD 08/11: F5 owns its own migration (the next free number
// when it is planned, after F4's thread_places; v2, TECH LEAD 09/11) that widens person_action_audit's action CHECK with preview-grant, preview-end and android-agents-can-see.
// SQLite cannot ALTER a CHECK, so the migration rebuilds the table in one transaction, keeping the rows and the
// append-only trigger (db/index.ts runs each migration in one transaction). Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f5-see-agent.md §S6.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f5/f5-audit-migration.native.test.ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db/index'

const open: AppDatabase[] = []
afterEach(() => { for (const db of open.splice(0)) db.close() })
const DIR = join(process.cwd(), 'electron/main/db/migrations')
/** F5's migration, found by its name so a renumber before execute keeps the test valid. */
function migration(): { file: string; number: number; sql: string } {
  const file = readdirSync(DIR).find(name => /^\d{3}_person_action_audit_actions\.sql$/.test(name))
  if (!file) throw new Error('no NNN_person_action_audit_actions.sql migration')
  return { file, number: Number(file.slice(0, 3)), sql: readFileSync(join(DIR, file), 'utf8') }
}
const insert = (db: AppDatabase, action: string) => db.prepare("INSERT INTO person_action_audit (ts, actor, action, target, outcome) VALUES (1, 'person', ?, 'x', 'ok')").run(action)

describe('F5 · the person_action_audit actions migration', () => {
  test('F5: it comes after F4\'s places migration that creates the table, and a fresh database takes the three new actions', () => {
    const { number } = migration()
    // v2 (TECH LEAD 09/11): numbers follow merge order, so F5's is the next free one when it is planned. It must come
    // after the migration that creates person_action_audit (F4's thread_places), found by name like F5's own.
    const places = readdirSync(DIR).find(name => /^\d{3}_thread_places\.sql$/.test(name))
    if (!places) throw new Error('no NNN_thread_places.sql migration (F4)')
    expect(number).toBeGreaterThan(Number(places.slice(0, 3)))
    const db = openInMemoryDatabase(); open.push(db)
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(number)
    for (const action of ['preview-grant', 'preview-end', 'android-agents-can-see']) expect(() => insert(db, action), action).not.toThrow()
  })

  test('F5: F4\'s actions are still accepted and an unknown action is still refused', () => {
    const db = openInMemoryDatabase(); open.push(db)
    for (const action of ['place-read', 'place-switch-back', 'place-undo', 'place-restore', 'place-discard', 'worktree-remove', 'branch-delete']) expect(() => insert(db, action), action).not.toThrow()
    for (const action of ['git-push', 'preview-everything', '']) expect(() => insert(db, action), action).toThrow()
  })

  test('F5: the rebuild keeps every existing row and the append-only trigger, in one transaction', () => {
    const db = openInMemoryDatabase(); open.push(db)
    insert(db, 'place-read'); insert(db, 'worktree-remove')
    const before = db.prepare('SELECT ts, actor, action, target, outcome FROM person_action_audit ORDER BY id').all()
    // Running the migration's rebuild again over a table that holds rows is the case an upgrade from F4's 095 meets.
    db.exec(migration().sql.replace(/PRAGMA user_version\s*=\s*\d+;/i, ''))
    expect(db.prepare('SELECT ts, actor, action, target, outcome FROM person_action_audit ORDER BY id').all()).toEqual(before)
    expect(() => db.prepare("UPDATE person_action_audit SET outcome = 'refused'").run()).toThrow()
    expect(() => insert(db, 'android-agents-can-see')).not.toThrow()
  })
})
