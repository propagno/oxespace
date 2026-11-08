// Frozen acceptance test for the 1.5.0 cockpit item R0b (OXE program, phase F2): the one-time export of the removed
// features' data. Written by the planner; the executor must not edit it. Temp folders and an in-memory database only.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f2/r0b-removed-features-export.native.test.ts
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db/index'
import { exportRemovedFeatures, markRemovedFeaturesNoticeShown, removedFeaturesState } from '../../../electron/main/services/data-export/removed-features-export'
import { IPC_CHANNELS } from '../../../shared/types/ipc'

const SECRET = 'SECRET-VALUE-never-exported-123'
let base: string
let userData: string
let root: string
let db: AppDatabase

function automations(): void {
  const store = new Database(join(userData, 'automations.sqlite3'))
  store.exec(`CREATE TABLE automations (id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL, root_path TEXT NOT NULL, agent TEXT NOT NULL, base_branch TEXT, schedule_json TEXT NOT NULL, precheck TEXT, extra_args TEXT NOT NULL DEFAULT '', timeout_minutes INTEGER NOT NULL DEFAULT 30, grace_minutes INTEGER NOT NULL DEFAULT 15, enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, last_run_at INTEGER, next_run_at INTEGER);
    CREATE TABLE automation_runs (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, scheduled_for INTEGER NOT NULL, status TEXT NOT NULL, started_at INTEGER, finished_at INTEGER, worktree_path TEXT, branch TEXT, exit_code INTEGER, output_tail TEXT NOT NULL DEFAULT '', message TEXT);`)
  store.prepare("INSERT INTO automations (id, name, prompt, root_path, agent, schedule_json, created_at) VALUES ('a1', 'Nightly tests', 'run the tests', ?, 'claude', '{\"kind\":\"daily\"}', 1)").run(root)
  store.prepare("INSERT INTO automation_runs (id, automation_id, scheduled_for, status) VALUES ('r1', 'a1', 2, 'done')").run()
  store.close()
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'oxe-r0b-'))
  userData = join(base, 'userData'); root = join(base, 'repo')
  mkdirSync(userData); mkdirSync(join(root, '.oxespace', 'requests', 'billing'), { recursive: true }); mkdirSync(join(root, '.oxespace', 'requests', 'environments'))
  writeFileSync(join(root, '.oxespace', 'requests', 'billing', 'list-invoices.http'), 'GET {{host}}/invoices\n')
  writeFileSync(join(root, '.oxespace', 'requests', 'environments', 'staging.json'), JSON.stringify({ name: 'Staging', production: false, variables: { host: 'https://api.example.com' }, secrets: ['API_KEY'] }))
  writeFileSync(join(userData, 'oxepost-secrets.json'), JSON.stringify({ any: { staging: { API_KEY: SECRET } } }))
  db = openInMemoryDatabase()
  db.prepare("INSERT INTO memory_projects (id, identity) VALUES ('p1', 'repo-identity')").run()
})
afterEach(() => { db.close(); rmSync(base, { recursive: true, force: true }) })

const exports = () => readdirSync(join(userData, 'exports')).filter(name => /^1\.5-removed-\d+\.json$/.test(name))

describe('R0b · the one-time export of the removed features\' data', () => {
  test('writes <userData>/exports/1.5-removed-<ts>.json with the OxePost collections, memories and automations', async () => {
    automations()
    const result = await exportRemovedFeatures({ db, userData, workspaceRoots: () => [root], now: () => 1_700_000_000_000 })
    expect(result.created).toBe(true)
    expect(exports()).toEqual(['1.5-removed-1700000000000.json'])
    expect(result.path).toBe(join(userData, 'exports', '1.5-removed-1700000000000.json'))
    const data = JSON.parse(readFileSync(result.path!, 'utf8')) as { sections: Record<string, unknown> }
    expect(Object.keys(data.sections).sort()).toEqual(['automations', 'memories', 'oxepostCollections'])
    const text = JSON.stringify(data)
    expect(text).toContain('list-invoices.http')
    expect(text).toContain('GET {{host}}/invoices')
    expect(text).toContain('API_KEY')
    expect(text).toContain('repo-identity')
    expect(text).toContain('Nightly tests')
    expect(text).toContain('"r1"')
  })

  test('never exports a secret value: only secret names, with a note that the secrets stay in OXESpace', async () => {
    automations()
    const result = await exportRemovedFeatures({ db, userData, workspaceRoots: () => [root], now: () => 1 })
    const text = readFileSync(result.path!, 'utf8')
    expect(text).not.toContain(SECRET)
    const data = JSON.parse(text) as { secretsNote?: unknown }
    expect(typeof data.secretsNote).toBe('string')
    expect(String(data.secretsNote).length).toBeGreaterThan(0)
  })

  test('HML-678-1: the user\'s secrets file and request files are byte-identical after the export', async () => {
    automations()
    const watched = [join(userData, 'oxepost-secrets.json'), join(root, '.oxespace', 'requests', 'billing', 'list-invoices.http'), join(root, '.oxespace', 'requests', 'environments', 'staging.json')]
    const before = watched.map(file => readFileSync(file))
    await exportRemovedFeatures({ db, userData, workspaceRoots: () => [root], now: () => 2 })
    await exportRemovedFeatures({ db, userData, workspaceRoots: () => [root], now: () => 3, force: true })
    watched.forEach((file, index) => expect(readFileSync(file).equals(before[index]), file).toBe(true))
  })

  test('HML-678-2: an unwritable exports folder leaves no partial file, reports the error, and is retried next time', async () => {
    writeFileSync(join(userData, 'exports'), 'a file where the folder should be')
    const deps = { db, userData, workspaceRoots: () => [root] }
    const failed = await exportRemovedFeatures({ ...deps, now: () => 80 })
    expect(failed).toMatchObject({ path: null, created: false })
    expect(typeof failed.error).toBe('string')
    expect(removedFeaturesState(deps)).toMatchObject({ file: null, exportedAt: null, error: expect.any(String) })
    expect(readdirSync(userData).filter(name => /1\.5-removed-|\.tmp$/.test(name))).toEqual([])
    rmSync(join(userData, 'exports'))
    const retried = await exportRemovedFeatures({ ...deps, now: () => 90 })
    expect(retried).toMatchObject({ path: join(userData, 'exports', '1.5-removed-90.json'), created: true })
    expect(removedFeaturesState(deps)).toMatchObject({ file: retried.path, error: null })
  })

  test('runs once: a second call writes nothing and returns the existing file', async () => {
    const first = await exportRemovedFeatures({ db, userData, workspaceRoots: () => [root], now: () => 10 })
    const second = await exportRemovedFeatures({ db, userData, workspaceRoots: () => [root], now: () => 20 })
    expect(second).toEqual({ path: first.path, created: false })
    expect(exports()).toEqual(['1.5-removed-10.json'])
  })

  test('FE-R0b\'s state: the file and whether the notice was shown, then the notice marked once', async () => {
    const deps = { db, userData, workspaceRoots: () => [root] }
    expect(removedFeaturesState(deps)).toMatchObject({ file: null, exportedAt: null, shownNotice: false })
    const first = await exportRemovedFeatures({ ...deps, now: () => 30 })
    expect(removedFeaturesState(deps)).toMatchObject({ file: first.path, exportedAt: new Date(30).toISOString(), shownNotice: false })
    markRemovedFeaturesNoticeShown(userData)
    markRemovedFeaturesNoticeShown(userData)
    expect(removedFeaturesState(deps)).toMatchObject({ file: first.path, exportedAt: new Date(30).toISOString(), shownNotice: true })
  })

  test('FE-R0b\'s state lists only the removed features this install used, as ids and booleans, with no content', () => {
    automations()
    const state = removedFeaturesState({ db, userData, workspaceRoots: () => [root] })
    const ids = ['codegraph', 'semantic', 'rtk', 'memory', 'linear', 'teams', 'automations', 'docs', 'oxepost', 'oxepod', 'work']
    for (const entry of state.removed) {
      expect(Object.keys(entry).sort()).toEqual(['hadData', 'hadSettings', 'id'])
      expect(ids).toContain(entry.id)
      expect(typeof entry.hadData).toBe('boolean')
      expect(typeof entry.hadSettings).toBe('boolean')
      expect(entry.hadData || entry.hadSettings).toBe(true)
    }
    const byId = new Map(state.removed.map(entry => [entry.id, entry]))
    expect(byId.get('memory')?.hadData).toBe(true)
    expect(byId.get('automations')?.hadData).toBe(true)
    expect(byId.get('oxepost')?.hadData).toBe(true)
    // A fresh database has no documentation, semantic, team or work rows and no settings for them.
    for (const unused of ['docs', 'semantic', 'teams', 'work']) expect(byId.has(unused), unused).toBe(false)
    const json = JSON.stringify(state)
    for (const content of ['repo-identity', 'Nightly tests', 'GET {{host}}', 'list-invoices', 'API_KEY', SECRET, root]) expect(json, content).not.toContain(content)
  })

  test('export again (force) writes a new file, and the state then names the newest one', async () => {
    const first = await exportRemovedFeatures({ db, userData, workspaceRoots: () => [root], now: () => 40 })
    const again = await exportRemovedFeatures({ db, userData, workspaceRoots: () => [root], now: () => 50, force: true })
    expect(again).toEqual({ path: join(userData, 'exports', '1.5-removed-50.json'), created: true })
    expect(exports().sort()).toEqual(['1.5-removed-40.json', '1.5-removed-50.json'])
    expect(removedFeaturesState({ db, userData, workspaceRoots: () => [root] }).file).toBe(again.path)
    expect(first.path).not.toBe(again.path)
  })

  test('the IPC channels for FE-R0b: state, markNoticeShown and exportAgain', () => {
    expect(IPC_CHANNELS.dataExport).toEqual({ state: 'data-export:state', markNoticeShown: 'data-export:mark-notice-shown', exportAgain: 'data-export:export-again' })
  })

  test('with nothing to save, no file is written, the state says so, and it is not retried', async () => {
    db.exec('DELETE FROM memory_projects')
    const deps = { db, userData, workspaceRoots: () => [join(base, 'no-such-repo')] }
    expect(await exportRemovedFeatures({ ...deps, now: () => 60 })).toEqual({ path: null, created: false })
    expect(await exportRemovedFeatures({ ...deps, now: () => 70 })).toEqual({ path: null, created: false })
    expect(removedFeaturesState(deps)).toMatchObject({ file: null, exportedAt: null, removed: [] })
    expect(existsSync(join(userData, 'exports')) ? exports() : []).toEqual([])
  })

  test('a missing table, folder or automations file is an empty section, never an error', async () => {
    db.exec('DROP TABLE IF EXISTS memory_note_uses; DROP TABLE IF EXISTS memory_notes')
    const result = await exportRemovedFeatures({ db, userData, workspaceRoots: () => [join(base, 'no-such-repo')], now: () => 5 })
    const data = JSON.parse(readFileSync(result.path!, 'utf8')) as { sections: Record<string, unknown> }
    expect(data.sections).toMatchObject({ automations: expect.anything(), memories: expect.anything(), oxepostCollections: expect.anything() })
    expect(JSON.stringify(data.sections.automations)).not.toContain('Nightly tests')
  })
})
