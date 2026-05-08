import { describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'

describe('migrations', () => {
  test('runs migrations and seeds built-in shell profiles', () => {
    const db = openInMemoryDatabase()

    expect(db.pragma('user_version', { simple: true })).toBe(3)

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>

    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining(['workspaces', 'panes', 'shell_profiles', 'agent_profiles', 'agent_readiness_cache'])
    )

    const profiles = db.prepare('SELECT id FROM shell_profiles ORDER BY id').all() as Array<{ id: string }>
    expect(profiles.map((profile) => profile.id)).toEqual(['builtin-claude', 'builtin-copilot'])

    db.close()
  })
})
