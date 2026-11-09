// @vitest-environment node
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
// @ts-expect-error -- a plain ES module script without type declarations
import { HISTORICAL_GAPS, checkTree, migrationFindings } from '../../scripts/check-migration-order.mjs'
import { removeTempDir } from '../helpers/removeTempDir'

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

// The frozen historical gaps (16, 17, 59, 81, 84, 86) live in scripts/check-migration-order.mjs.
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

  it('finds this tree in order: every number below the highest is here, and LATEST_DB_VERSION matches it', () => {
    // On a failure the finding says which migration to merge first.
    expect(checkTree('.')).toEqual([])
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

/** A checkout with only what the guard reads: the migrations folder and the runner's LATEST_DB_VERSION. */
describe('the migration order guard, on a tree (1.5.0 reserves 094, 095 and 096)', () => {
  const roots: string[] = []
  afterEach(() => { for (const root of roots.splice(0)) removeTempDir(root) })
  const upTo = (n: number): string[] => Array.from({ length: n }, (_, i) => i + 1).filter(k => !HISTORICAL_GAPS.includes(k)).map(k => `${String(k).padStart(3, '0')}_m${k}.sql`)
  const tree = (names: string[], latest: number): string => {
    const root = mkdtempSync(join(tmpdir(), 'oxe-migration-order-'))
    roots.push(root)
    mkdirSync(join(root, 'electron', 'main', 'db', 'migrations'), { recursive: true })
    for (const name of names) writeFileSync(join(root, 'electron', 'main', 'db', 'migrations', name), `PRAGMA user_version = ${Number(name.slice(0, 3))};\n`)
    writeFileSync(join(root, 'electron', 'main', 'db', 'index.ts'), `export const LATEST_DB_VERSION = ${latest}\n`)
    return root
  }

  it('fails a PR that adds 096 over a main that has no 095, and names the one to merge first', () => {
    const findings = checkTree(tree([...upTo(94), '096_remote_hidden_panes.sql'], 96))
    expect(findings).toEqual([expect.stringMatching(/^merge 095 first: this tree has 096 but not 095\./)])
  })

  it('passes the same PR once 095 is on main', () => {
    expect(checkTree(tree([...upTo(95), '096_remote_hidden_panes.sql'], 96))).toEqual([])
  })

  it('names every missing number, lowest first', () => {
    expect(checkTree(tree([...upTo(93), '096_remote_hidden_panes.sql'], 96))[0]).toMatch(/^merge 094, 095 first: this tree has 096 but not 094, 095\./)
  })

  it('fails when LATEST_DB_VERSION does not match the highest migration, either way', () => {
    expect(checkTree(tree(upTo(95), 94))).toEqual(['LATEST_DB_VERSION is 94, but the highest migration is 095: set it to 95'])
    expect(checkTree(tree(upTo(94), 95))).toEqual(['LATEST_DB_VERSION is 95, but the highest migration is 094: set it to 94'])
  })

  it('keeps the frozen historical gaps, and reports a missing LATEST_DB_VERSION', () => {
    expect(migrationFindings({ files: upTo(93), latest: 93 })).toEqual([])
    expect(migrationFindings({ files: upTo(93), latest: Number.NaN })).toEqual(['LATEST_DB_VERSION is missing from electron/main/db/index.ts'])
  })
})
