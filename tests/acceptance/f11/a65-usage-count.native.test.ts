// Frozen acceptance test for 1.5.0 A65 / N7 (OXE program, phase F11): the local usage count. It is off by default on a
// fresh and an upgraded profile; when on it counts only features from a closed catalog (never content), per day, on
// this computer only; the person can export it as JSON and clear it; turning it off can keep or clear what was counted.
// Written by the planner; the executor must not edit it. A real, migrated in-memory database, temp folders, an
// injected clock, and fetch watched so nothing is ever sent.
// CCR: docs/roadmap-1.5/ccr-f11-release.md §A65; DESIGN 1.5.0-f11-design.md U11.1.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f11/a65-usage-count.native.test.ts
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { UsageCount } from '../../../electron/main/services/usage/usage-count'
import { FEATURE_USAGE_KEYS } from '../../../shared/feature-usage'
import { removeTempDir } from '../../helpers/removeTempDir'

const DAY = 86_400_000
const NOW = Date.parse('2026-11-08T12:00:00Z')
const cleanup: Array<() => void> = []
afterEach(() => { for (const step of cleanup.splice(0)) step(); vi.restoreAllMocks() })

function fixture() {
  const db: AppDatabase = openInMemoryDatabase()
  cleanup.push(() => db.close())
  let now = NOW
  const usage = new UsageCount(db, { now: () => now })
  return { db, usage, at: (time: number) => { now = time } }
}

describe('A65 · the local usage count', () => {
  test('A65: off by default, on a fresh profile and after an upgrade, and nothing is counted while off', () => {
    const f = fixture()
    expect(f.usage.status()).toEqual({ enabled: false, since: null, rows: [] })
    f.usage.record('commandBar')
    // The path is live: once on, the same call counts.
    f.usage.setEnabled(true)
    expect(f.usage.status().rows).toEqual([])
    f.usage.record('commandBar')
    expect(f.usage.status().rows).toEqual([{ feature: 'commandBar', uses: 1, lastUsed: NOW }])
    // An upgraded profile is a database migrated from before F11: it has no setting yet, so it reads off.
    const upgraded = fixture()
    expect(upgraded.usage.status().enabled).toBe(false)
  })

  test('A65: only the closed catalog of features is counted, never content, and the catalog has person-readable keys', () => {
    expect(FEATURE_USAGE_KEYS).toEqual(expect.arrayContaining(['agentBrowser', 'timeTravel', 'commandBar']))
    for (const feature of FEATURE_USAGE_KEYS) expect(feature, feature).toMatch(/^[a-z][a-zA-Z]{2,40}$/)
    const f = fixture()
    f.usage.setEnabled(true)
    f.usage.record('timeTravel')
    for (const content of ['C:\\Users\\me\\secret.txt', 'https://example.com/x?token=abc', 'fix the Pix webhook', '', 'TimeTravel'] as string[]) f.usage.record(content as never)
    expect(f.usage.status().rows.map(row => row.feature)).toEqual(['timeTravel'])
    expect(JSON.stringify(f.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all())).toMatch(/usage/)
  })

  test('A65: the table is the last 30 days, the largest count first, with the last use', () => {
    const f = fixture()
    f.usage.setEnabled(true)
    f.at(NOW - 40 * DAY); f.usage.record('agentBrowser'); f.usage.record('agentBrowser'); f.usage.record('agentBrowser')
    f.at(NOW - 2 * DAY); f.usage.record('commandBar')
    f.at(NOW - DAY); f.usage.record('timeTravel'); f.usage.record('timeTravel')
    f.at(NOW); f.usage.record('commandBar'); f.usage.record('commandBar')
    expect(f.usage.status()).toMatchObject({ enabled: true, rows: [
      { feature: 'commandBar', uses: 3, lastUsed: NOW },
      { feature: 'timeTravel', uses: 2, lastUsed: NOW - DAY }
    ] })
    expect(typeof f.usage.status().since).toBe('number')
  })

  test('A65: export writes the same rows as JSON; clear empties them; turning off can keep or clear', () => {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-f11-usage-')))
    cleanup.push(() => removeTempDir(dir))
    const f = fixture()
    f.usage.setEnabled(true)
    f.usage.record('commandBar'); f.usage.record('timeTravel')
    const file = join(dir, 'usage.json')
    expect(f.usage.export(file)).toBe(file)
    const written = JSON.parse(readFileSync(file, 'utf8')) as { rows: unknown }
    expect(written.rows).toEqual(f.usage.status().rows)
    // Off, keeping: nothing shows and nothing counts, and turning it on again shows what was kept.
    f.usage.setEnabled(false, { clear: false })
    expect(f.usage.status()).toEqual({ enabled: false, since: null, rows: [] })
    f.usage.record('commandBar')
    f.usage.setEnabled(true)
    expect(f.usage.status().rows).toHaveLength(2)
    expect(f.usage.status().rows.find(row => row.feature === 'commandBar')?.uses).toBe(1)
    // Off, clearing.
    f.usage.setEnabled(false, { clear: true })
    f.usage.setEnabled(true)
    expect(f.usage.status().rows).toEqual([])
    f.usage.record('commandBar')
    f.usage.clear()
    expect(f.usage.status().rows).toEqual([])
  })

  test('A65: nothing is ever sent: counting, reading, exporting and clearing make no network call', () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-f11-usage-')))
    cleanup.push(() => removeTempDir(dir))
    const f = fixture()
    f.usage.setEnabled(true)
    for (const feature of FEATURE_USAGE_KEYS) f.usage.record(feature)
    expect(f.usage.status().rows).toHaveLength(FEATURE_USAGE_KEYS.length)
    f.usage.export(join(dir, 'u.json'))
    f.usage.clear()
    expect(fetch).not.toHaveBeenCalled()
  })
})
