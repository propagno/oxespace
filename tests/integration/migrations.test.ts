import { describe, expect, test } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'

describe('migrations', () => {
  test('runs migrations and seeds built-in shell profiles', () => {
    const db = openInMemoryDatabase()

    expect(db.pragma('user_version', { simple: true })).toBe(10)

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

    const workspaceColumns = db.prepare("PRAGMA table_info('workspaces')").all() as Array<{ name: string }>
    expect(workspaceColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'editor_visible',
        'editor_expanded',
        'editor_width_percent',
        'theme_id',
        'ui_density',
        'layout_preset',
        'oxe_panel_visible',
        'oxe_panel_expanded',
        'oxe_panel_width_percent'
      ])
    )

    const profiles = db
      .prepare('SELECT id, name, executable, args_json FROM shell_profiles ORDER BY id')
      .all() as Array<{ id: string; name: string; executable: string; args_json: string }>
    expect(profiles.map((profile) => profile.id)).toEqual(['builtin-claude', 'builtin-copilot'])
    expect(profiles.find((profile) => profile.id === 'builtin-copilot')).toEqual(
      expect.objectContaining({
        name: 'copilot shell',
        executable: 'powershell.exe',
        args_json: '["-NoLogo"]'
      })
    )

    const agents = db.prepare('SELECT provider, command FROM agent_profiles WHERE is_builtin = 1 ORDER BY provider').all()
    expect(agents).toEqual([
      { provider: 'claude', command: 'claude' },
      { provider: 'copilot', command: 'copilot' }
    ])

    db.close()
  })
})
