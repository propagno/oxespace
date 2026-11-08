import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// Static check (marked): R9 removed the documentation service, but migration 049 and its tables stay in the database.
const MIGRATIONS = join(process.cwd(), 'electron/main/db/migrations')
const TABLES = ['documentation_jobs', 'documentation_checkpoints', 'documentation_operations']

describe('R9 · the documentation data stays in the database', () => {
  test('migration 049 still creates the documentation tables', () => {
    const sql = readFileSync(join(MIGRATIONS, '049_documentation.sql'), 'utf8')
    for (const table of TABLES) expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`))
  })
  test('no migration drops them', () => {
    const offenders = readdirSync(MIGRATIONS)
      .filter(name => name.endsWith('.sql'))
      .filter(name => /DROP\s+TABLE[^;]*documentation_/i.test(readFileSync(join(MIGRATIONS, name), 'utf8')))
    expect(offenders).toEqual([])
  })
})
