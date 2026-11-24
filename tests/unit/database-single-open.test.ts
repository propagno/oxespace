import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, test, vi } from 'vitest'

const constructedPaths: Array<{ path: string; options?: unknown }> = []
let mockedUserVersion = 0

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => tmpdir()
  }
}))

vi.mock('better-sqlite3', () => {
  class FakeDatabase {
    private version: number
    constructor(path: string, options?: unknown) {
      constructedPaths.push({ path, options })
      this.version = mockedUserVersion
    }

    pragma(sql: string, opts?: { simple?: boolean }): unknown {
      if (sql === 'user_version' && opts?.simple) return this.version
      const match = /^user_version\s*=\s*(\d+)$/.exec(sql.trim())
      if (match) {
        this.version = Number(match[1])
        return undefined
      }
      return []
    }

    prepare(sql: string) {
      return {
        all: () => [],
        get: () => {
          if (sql.includes('sqlite_master')) return { name: 'mock' }
          if (sql.includes('count(*)')) return { n: 0 }
          return undefined
        },
        run: () => undefined
      }
    }

    exec(sql: string): void {
      const matches = [...sql.matchAll(/PRAGMA\s+user_version\s*=\s*(\d+)/gi)]
      if (matches.length > 0) {
        this.version = Number(matches[matches.length - 1][1])
      }
    }

    transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
      return fn
    }

    close(): void {}
  }

  return { default: FakeDatabase }
})

describe('openDatabaseWithMetadata (single SQLite open)', () => {
  afterEach(() => {
    constructedPaths.length = 0
  })

  test('opens SQLite once for an up-to-date database and reports previousVersion', async () => {
    const { LATEST_DB_VERSION, openDatabaseWithMetadata } = await import('../../electron/main/db/index')
    mockedUserVersion = LATEST_DB_VERSION

    const dbPath = join(tmpdir(), `oxe-347-up-to-date-${Date.now()}.sqlite3`)
    const { db, previousVersion } = openDatabaseWithMetadata(dbPath)

    expect(db).toBeDefined()
    expect(previousVersion).toBe(LATEST_DB_VERSION)
    expect(constructedPaths).toHaveLength(1)
    expect(constructedPaths[0]).toEqual({ path: dbPath, options: undefined })
  })

  test('opens SQLite once for a fresh database and reports previousVersion 0 before migrations', async () => {
    const { LATEST_DB_VERSION, openDatabaseWithMetadata } = await import('../../electron/main/db/index')
    mockedUserVersion = 0

    const dbPath = join(tmpdir(), `oxe-347-fresh-${Date.now()}.sqlite3`)
    const { db, previousVersion } = openDatabaseWithMetadata(dbPath)

    expect(previousVersion).toBe(0)
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_DB_VERSION)
    expect(constructedPaths).toHaveLength(1)
  })

  test('openDatabase preserves its handle-only return type via the single open path', async () => {
    const { LATEST_DB_VERSION, openDatabase } = await import('../../electron/main/db/index')
    mockedUserVersion = LATEST_DB_VERSION

    const dbPath = join(tmpdir(), `oxe-347-compat-${Date.now()}.sqlite3`)
    const db = openDatabase(dbPath)

    expect(typeof db.pragma).toBe('function')
    expect(constructedPaths).toHaveLength(1)
  })
})
