import { describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'

describe('migrations', () => {
  test('runs migrations and seeds built-in shell profiles', () => {
    const db = openInMemoryDatabase()

    expect(db.pragma('user_version', { simple: true })).toBe(5)

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>

    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining([
        'workspaces',
        'panes',
        'shell_profiles',
        'agent_profiles',
        'agent_readiness_cache',
        'tasks',
        'task_executions'
      ])
    )

    const profiles = db.prepare('SELECT id FROM shell_profiles ORDER BY id').all() as Array<{ id: string }>
    expect(profiles.map((profile) => profile.id)).toEqual(['builtin-claude', 'builtin-copilot'])

    const agents = db.prepare('SELECT provider, command FROM agent_profiles WHERE is_builtin = 1 ORDER BY provider').all()
    expect(agents).toEqual([
      { provider: 'claude', command: 'claude' },
      { provider: 'copilot', command: 'copilot' }
    ])

    db.close()
  })
})
