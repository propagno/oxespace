import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeFutureDatabase } from '../../e2e/acceptance/future-db'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('T87: a database from a newer OXESpace', () => {
  it('is refused with the newer-schema mark, untouched, and classified for the startup screen', async () => {
    const { openDatabase, LATEST_DB_VERSION } = await import('../../electron/main/db')
    const { describeStartupFailure } = await import('../../electron/main/startup-failure')
    const dir = mkdtempSync(join(tmpdir(), 'oxe-t87-'))
    dirs.push(dir)
    const path = join(dir, 'oxespace.sqlite3')
    writeFutureDatabase(path, LATEST_DB_VERSION + 50)
    let thrown: unknown
    try { openDatabase(path).close() } catch (error) { thrown = error }
    expect(thrown).toMatchObject({ newerSchema: true, fromVersion: LATEST_DB_VERSION + 50, latest: LATEST_DB_VERSION })
    expect(describeStartupFailure(thrown, path)).toMatchObject({ code: 'newer-schema', backupsPath: join(dir, 'db-backups'), databasePath: path })
    // Refused before any migration: no backup was taken of a database this version cannot read.
    const Database = (await import('better-sqlite3')).default
    const db = new Database(path, { readonly: true })
    try { expect(db.pragma('user_version', { simple: true })).toBe(LATEST_DB_VERSION + 50) } finally { db.close() }
  })
})
