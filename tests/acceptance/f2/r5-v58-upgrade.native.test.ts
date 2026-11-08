// Frozen acceptance test for the 1.5.0 cockpit item R5 (OXE program, phase F2): with AI Memory removed, a database at
// v58 that holds memory rows still upgrades, and no table is dropped. Written by the planner; the executor must not edit
// it. Same replay method as tests/integration/db-replay.native.test.ts. Temp folder only.
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f2/r5-v58-upgrade.native.test.ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { LATEST_DB_VERSION, openDatabase } from '../../../electron/main/db/index'

const KEPT = ['memory_projects', 'memory_runtime', 'memory_notes', 'semantic_documents', 'semantic_embeddings', 'documentation_jobs', 'documentation_checkpoints', 'agent_teams', 'agent_team_members', 'work_runs', 'work_tasks']
let directory: string
let path: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'oxe-r5-')); path = join(directory, 'oxespace.sqlite3') })
afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

const tables = (db: { prepare(sql: string): { all(): unknown[] } }): string[] => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(row => row.name)

describe('R5 · a v58 database with AI Memory upgrades after the module is gone', () => {
  test('the memory module is gone from the app', () => {
    expect(existsSync(join(process.cwd(), 'electron/main/services/memory'))).toBe(false)
  })

  test('a v58 database with memory rows reaches the latest version, with its memory rows and every table kept', () => {
    const seed = openDatabase(path)
    try {
      seed.prepare("INSERT INTO memory_projects (id, identity) VALUES ('p1', 'repo-identity')").run()
    } finally { seed.close() }
    const rewind = new Database(path)
    try { rewind.pragma('user_version = 58') } finally { rewind.close() }

    const db = openDatabase(path)
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST_DB_VERSION)
      expect(db.prepare("SELECT identity FROM memory_projects WHERE id = 'p1'").get()).toEqual({ identity: 'repo-identity' })
      const present = tables(db)
      expect(KEPT.filter(name => !present.includes(name))).toEqual([])
    } finally { db.close() }
  })
})
