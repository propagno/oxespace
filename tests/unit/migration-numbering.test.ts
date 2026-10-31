// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The runner applies a migration when the database's `user_version` is below its number. A PR that merges with a
 * stale number (one above the next free, or one below what main already reached) leaves a gap a database past it
 * skips for good. These checks make that a CI failure on main's merge ref instead of a silently skipped migration.
 * The real fix, applying migrations by id, stays the B8 item for after 1.4.
 */
const folder = join('electron', 'main', 'db', 'migrations')
const runner = readFileSync(join('electron', 'main', 'db', 'index.ts'), 'utf8')
const files = readdirSync(folder).filter(name => name.endsWith('.sql')).sort()
const numberOf = (name: string): number => Number(/^(\d{3})_/.exec(name)?.[1] ?? NaN)
const latest = Number(/export const LATEST_DB_VERSION = (\d+)/.exec(runner)?.[1] ?? NaN)

/**
 * Numbers that never shipped a file; frozen, so a new gap fails. 086 was skipped: #294 landed 087 before #180, so the
 * gateway took 088 (a database already at 87 would never run an 086).
 */
const HISTORICAL_GAPS = [16, 17, 59, 81, 84, 86]
/** One number, two files: 046 is split by platform (PowerShell on Windows, POSIX shells elsewhere). */
const PLATFORM_SPLIT = new Map([[46, ['046_shell_profiles_posix.sql', '046_shell_profiles_win.sql']]])
/** Frozen history: 001 has set version 2 since before the convention. */
const VERSION_EXCEPTIONS = new Map([['001_initial.sql', 2]])
/** Frozen history: 040's change is applied inline by the runner (idempotent column adds), so its file is not read. */
const APPLIED_INLINE = ['040_semantic_embedding_blob.sql']

describe('migration numbering', () => {
  it('names every file NNN_name.sql', () => {
    for (const name of files) expect(name, name).toMatch(/^\d{3}_[a-z0-9_]+\.sql$/)
  })

  it('runs 1..LATEST_DB_VERSION with no new gap: every number but the frozen historical ones has a file', () => {
    expect(Number.isInteger(latest)).toBe(true)
    const numbers = new Set(files.map(numberOf))
    expect(Math.max(...numbers)).toBe(latest)
    const missing = Array.from({ length: latest }, (_, index) => index + 1).filter(number => !numbers.has(number))
    expect(missing).toEqual(HISTORICAL_GAPS)
  })

  it('gives each number one file, but the platform split', () => {
    const byNumber = new Map<number, string[]>()
    for (const name of files) byNumber.set(numberOf(name), [...(byNumber.get(numberOf(name)) ?? []), name])
    for (const [number, names] of byNumber) expect(names, String(number)).toEqual(PLATFORM_SPLIT.get(number) ?? [names[0]])
  })

  it('sets user_version to the number in the name of each file', () => {
    for (const name of files) {
      const version = /PRAGMA user_version = (\d+);/.exec(readFileSync(join(folder, name), 'utf8'))?.[1]
      expect(Number(version), name).toBe(VERSION_EXCEPTIONS.get(name) ?? numberOf(name))
    }
  })

  it('has the runner read every file, in ascending order', () => {
    const read = [...runner.matchAll(/'(\d{3}_[a-z0-9_]+\.sql)'/g)].map(match => match[1])
    expect([...new Set(read)].sort()).toEqual(files.filter(name => !APPLIED_INLINE.includes(name)))
    const order = read.map(numberOf)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })
})
