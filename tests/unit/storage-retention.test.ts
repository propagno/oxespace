import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pruneStorage } from '../../electron/main/services/storage-retention'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 29)
let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'oxe-retention-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function put(relative: string, ageDays: number, bytes = 10): string {
  const path = join(root, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, Buffer.alloc(bytes))
  const when = new Date(NOW - ageDays * DAY)
  utimesSync(path, when, when)
  return path
}

describe('pruneStorage', () => {
  it('keeps the newest pre-migration copies whatever their age and removes older stale ones', () => {
    const newest = put('db-backups/oxespace-v73-a.sqlite3', 14)
    const second = put('db-backups/oxespace-v63-b.sqlite3', 15)
    const stale = put('db-backups/oxespace-v59-c.sqlite3', 22)
    const result = pruneStorage(root, NOW)
    expect(existsSync(newest) && existsSync(second)).toBe(true)
    expect(existsSync(stale)).toBe(false)
    expect(result.removed).toEqual([stale])
  })

  it('keeps recent copies beyond the newest two until they age out', () => {
    for (const [name, age] of [['a', 1], ['b', 2], ['c', 3]] as const) put(`db-backups/oxespace-v80-${name}.sqlite3`, age)
    expect(pruneStorage(root, NOW).removed).toEqual([])
  })

  it('removes a recovery copy of the database after two weeks, and only that', () => {
    const old = put('oxespace.sqlite3.pre-recovery-1782672130.bak', 120, 100)
    const live = put('oxespace.sqlite3', 120)
    const wal = put('oxespace.sqlite3-wal', 120)
    const result = pruneStorage(root, NOW)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(live) && existsSync(wal)).toBe(true)
    expect(result.freedBytes).toBe(100)
  })

  it('removes crash dumps older than a week and keeps recent ones', () => {
    const old = put('Crashpad/reports/old.dmp', 10)
    const recent = put('Crashpad/reports/recent.dmp', 1)
    pruneStorage(root, NOW)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(recent)).toBe(true)
  })

  it('does nothing when the folders do not exist', () => {
    expect(pruneStorage(join(root, 'missing'), NOW)).toEqual({ removed: [], freedBytes: 0 })
  })
})
