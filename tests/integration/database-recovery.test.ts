// @vitest-environment node
import Database from 'better-sqlite3'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, test } from 'vitest'
import { openDatabase } from '../../electron/main/db/index'

const roots: string[] = []
const handles: Database.Database[] = []
afterEach(() => {
  for (const handle of handles.splice(0)) { if (handle.open) handle.close() }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'oxe-db-recovery-'))
  roots.push(root)
  const path = join(root, 'app.sqlite3')
  const db = openDatabase(path)
  handles.push(db)
  db.exec("CREATE TABLE recovery_probe (value TEXT); INSERT INTO recovery_probe VALUES ('committed'); PRAGMA user_version=61;")
  return { root, path, db }
}

test('upgrade snapshot contains committed WAL data and can be opened independently', () => {
  const { root, path, db } = fixture()
  db.pragma('wal_autocheckpoint = 0')
  db.exec("INSERT INTO recovery_probe VALUES ('still in WAL')")
  expect(readFileSync(path + '-wal').length).toBeGreaterThan(0)
  const upgraded = openDatabase(path)
  handles.push(upgraded)
  const files = readdirSync(join(root, 'db-backups'))
  expect(files).toHaveLength(1)
  const backup = new Database(join(root, 'db-backups', files[0]), { readonly: true })
  handles.push(backup)
  expect(backup.pragma('integrity_check', { simple: true })).toBe('ok')
  expect(backup.pragma('user_version', { simple: true })).toBe(61)
  expect(backup.prepare('SELECT value FROM recovery_probe ORDER BY rowid').all()).toEqual([{ value: 'committed' }, { value: 'still in WAL' }])
  expect(upgraded.pragma('user_version', { simple: true })).toBe(63)
})

test('failed backup stops migration and preserves original version and data', () => {
  const { root, path, db } = fixture()
  writeFileSync(join(root, 'db-backups'), 'blocks creation of backup directory')
  expect(() => openDatabase(path)).toThrow('Database upgrade stopped')
  expect(db.pragma('user_version', { simple: true })).toBe(61)
  expect(db.prepare('SELECT value FROM recovery_probe').get()).toEqual({ value: 'committed' })
  expect(readdirSync(root).some(name => name.includes('.corrupt-'))).toBe(false)
})

test('an older application refuses a newer schema without modifying data', () => {
  const { path, db } = fixture()
  db.pragma('user_version=999')
  expect(() => openDatabase(path)).toThrow('newer OXESpace version')
  expect(db.pragma('user_version', { simple: true })).toBe(999)
  expect(db.prepare('SELECT value FROM recovery_probe').get()).toEqual({ value: 'committed' })
})

test('a locked writer never detaches WAL and committed data survives a later retry', () => {
  const { root, path, db } = fixture()
  db.exec('BEGIN EXCLUSIVE')
  try {
    expect(() => openDatabase(path)).toThrow()
    expect(readdirSync(root).some(name => name.includes('.corrupt-'))).toBe(false)
    expect(readFileSync(path + '-wal').length).toBeGreaterThan(0)
  } finally { db.exec('ROLLBACK') }
  const recovered = openDatabase(path)
  handles.push(recovered)
  expect(recovered.prepare('SELECT value FROM recovery_probe').get()).toEqual({ value: 'committed' })
}, 40000)
