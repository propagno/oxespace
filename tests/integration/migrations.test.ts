import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { LATEST_DB_VERSION, openInMemoryDatabase, runMigrations } from '../../electron/main/db/index'

// Literal on purpose: it verifies the migration SQL itself sets this version,
// independently of the runner's constant. Bump both when adding a migration.
const EXPECTED_SCHEMA_VERSION = 46

// Migration 046 is platform-split: Windows keeps PowerShell as the neutral
// built-in shell, every other host is repointed to bash. The assertions below
// follow the host so the suite is meaningful on both.
const IS_WINDOWS = process.platform === 'win32'
const NEUTRAL_SHELL_ID = IS_WINDOWS ? 'builtin-powershell' : 'builtin-bash'

/**
 * The POSIX half of migration 046 only runs when the host is not Windows, which
 * would leave it unverified on the Windows dev machines and in the Windows CI
 * leg. Applying the SQL directly exercises it on every host.
 */
describe('migration 046 (POSIX variant)', () => {
  const posixSql = readFileSync(
    join(__dirname, '../../electron/main/db/migrations/046_shell_profiles_posix.sql'),
    'utf8'
  )

  /**
   * A freshly migrated database has no workspaces or panes, so asserting that
   * nothing points at builtin-powershell would pass vacuously. Seed a real
   * workspace with two panes on the Windows baseline first — that is the state
   * an actual user carries across to Linux, and the only one where the repoint
   * has anything to do.
   */
  function migratedToPosix(): ReturnType<typeof openInMemoryDatabase> {
    const db = openInMemoryDatabase()
    db.exec(`
      UPDATE shell_profiles
      SET executable = 'powershell.exe', args_json = '["-NoLogo"]'
      WHERE id = 'builtin-copilot'
    `)
    db.prepare(`
      INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id)
      VALUES ('ws-1', 'Repo', '/tmp/repo', '1x2', 'builtin-powershell')
    `).run()
    const insertPane = db.prepare(`
      INSERT INTO panes (id, workspace_id, row_index, column_index, shell_profile_id)
      VALUES (?, 'ws-1', 0, ?, ?)
    `)
    insertPane.run('pane-shell', 0, 'builtin-powershell')
    // An agent pane must survive untouched — 046 may only move the neutral shell.
    insertPane.run('pane-agent', 1, 'builtin-claude')

    db.exec(posixSql)
    return db
  }

  test('seeds bash and repoints every PowerShell reference', () => {
    const db = migratedToPosix()
    try {
      expect(db.prepare('SELECT * FROM shell_profiles WHERE id = ?').get('builtin-bash')).toEqual(
        expect.objectContaining({ name: 'Bash', executable: '/bin/bash', args_json: '["-l"]' })
      )
      expect(db.prepare('SELECT * FROM shell_profiles WHERE id = ?').get('builtin-copilot')).toEqual(
        expect.objectContaining({ executable: '/bin/bash', args_json: '[]' })
      )
      // Nothing may still point at a shell that cannot spawn on this host.
      expect(db.prepare("SELECT COUNT(*) AS n FROM panes WHERE shell_profile_id = 'builtin-powershell'").get())
        .toEqual({ n: 0 })
      expect(db.prepare("SELECT COUNT(*) AS n FROM workspaces WHERE default_shell_profile_id = 'builtin-powershell'").get())
        .toEqual({ n: 0 })
      // …and the neutral pane must have actually moved, not merely stopped
      // matching because the fixture was empty.
      expect(db.prepare("SELECT shell_profile_id AS id FROM panes WHERE id = 'pane-shell'").get())
        .toEqual({ id: 'builtin-bash' })
      expect(db.prepare("SELECT default_shell_profile_id AS id FROM workspaces WHERE id = 'ws-1'").get())
        .toEqual({ id: 'builtin-bash' })
      // Agent panes are not the neutral shell and must be left alone.
      expect(db.prepare("SELECT shell_profile_id AS id FROM panes WHERE id = 'pane-agent'").get())
        .toEqual({ id: 'builtin-claude' })
      expect(db.pragma('foreign_key_check')).toEqual([])
      expect(db.pragma('user_version', { simple: true })).toBe(46)
    } finally {
      db.close()
    }
  })

  test('keeps the builtin-powershell row so foreign keys stay valid', () => {
    // Deleting it would make a database moved back to Windows unrepairable.
    const db = migratedToPosix()
    try {
      expect(db.prepare('SELECT id FROM shell_profiles WHERE id = ?').get('builtin-powershell'))
        .toEqual({ id: 'builtin-powershell' })
    } finally {
      db.close()
    }
  })

  test('a Linux-migrated database is repairable after moving back to Windows', () => {
    // The accepted trade-off of doing this as a migration rather than a runtime
    // reconcile: 046 has already applied, so reopening on Windows leaves panes
    // on builtin-bash. docs/DEVELOPMENT_GUIDE.md publishes a two-statement
    // repair — this proves those exact statements restore a working state, and
    // that the kept builtin-powershell row is what makes it possible.
    const db = migratedToPosix()
    try {
      expect(db.prepare("SELECT COUNT(*) AS n FROM panes WHERE shell_profile_id = 'builtin-bash'").get())
        .not.toEqual({ n: 0 })

      db.exec("UPDATE panes SET shell_profile_id = 'builtin-powershell' WHERE shell_profile_id = 'builtin-bash'")
      db.exec("UPDATE workspaces SET default_shell_profile_id = 'builtin-powershell' WHERE default_shell_profile_id = 'builtin-bash'")

      expect(db.prepare("SELECT COUNT(*) AS n FROM panes WHERE shell_profile_id = 'builtin-bash'").get())
        .toEqual({ n: 0 })
      expect(db.prepare("SELECT COUNT(*) AS n FROM workspaces WHERE default_shell_profile_id = 'builtin-bash'").get())
        .toEqual({ n: 0 })
      // Foreign keys must still hold, and the version must not regress — a
      // second Windows boot has to be a no-op, not a re-migration.
      expect(db.pragma('foreign_key_check')).toEqual([])
      expect(db.pragma('user_version', { simple: true })).toBe(46)
      runMigrations(db)
      expect(db.pragma('user_version', { simple: true })).toBe(EXPECTED_SCHEMA_VERSION)
    } finally {
      db.close()
    }
  })

  test('is idempotent — re-applying changes nothing', () => {
    const db = migratedToPosix()
    try {
      const before = db.prepare('SELECT * FROM shell_profiles ORDER BY id').all()
      db.exec(posixSql)
      expect(db.prepare('SELECT * FROM shell_profiles ORDER BY id').all()).toEqual(before)
      expect(db.pragma('user_version', { simple: true })).toBe(46)
    } finally {
      db.close()
    }
  })
})

describe('migrations', () => {
  test('migration 040 self-heals a partial apply (columns exist but user_version < 40)', () => {
    // Reproduces the v0.2.6/0.2.7 upgrade-crash state: 040 added embedding_blob/dim
    // but a crash/disk-I/O kept user_version at 39. The old non-idempotent 040 then
    // threw "duplicate column name: embedding_blob" on EVERY boot, bricking the app.
    const db = openInMemoryDatabase() // fully migrated, columns present
    db.pragma('user_version = 39') // simulate the partial-apply state
    expect(db.pragma('user_version', { simple: true })).toBe(39)

    // The fixed 040 must NOT throw (idempotent) and must finish the version bump.
    expect(() => runMigrations(db)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(EXPECTED_SCHEMA_VERSION)
    const cols = (db.prepare("PRAGMA table_info('semantic_embeddings')").all() as Array<{ name: string }>).map((c) => c.name)
    expect(cols).toEqual(expect.arrayContaining(['embedding_blob', 'dim']))
    db.close()
  })

  test('the runner constant matches the version the migration SQL sets', () => {
    // A mismatch silently disables the pre-migration backup for the new version.
    expect(LATEST_DB_VERSION).toBe(EXPECTED_SCHEMA_VERSION)
  })

  test('runs migrations and seeds built-in shell profiles', () => {
    const db = openInMemoryDatabase()

    expect(db.pragma('user_version', { simple: true })).toBe(EXPECTED_SCHEMA_VERSION)

    // 045: encrypted third-party credentials (Linear).
    const credentialColumns = db.prepare("PRAGMA table_info('secure_credentials')").all() as Array<{ name: string }>
    expect(credentialColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['provider', 'payload', 'encrypted', 'label'])
    )

    // 040: binary Float32 embedding storage columns.
    const semanticColumns = db.prepare("PRAGMA table_info('semantic_embeddings')").all() as Array<{ name: string }>
    expect(semanticColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['embedding_json', 'embedding_blob', 'dim', 'chunk_metadata_json'])
    )

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
        'task_executions',
        'background_jobs',
        'session_forks',
        'task_dependencies',
        'mcp_servers',
        'integration_groups',
        'integration_group_members',
        'integration_group_sessions',
        'integration_handoffs',
        'semantic_documents',
        'semantic_documents_fts'
      ])
    )

    db.prepare('INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES (?, ?, ?, ?, ?)')
      .run('semantic-test', 'Semantic test', '/tmp/semantic-test', '1x1', 'builtin-powershell')
    db.prepare('INSERT INTO semantic_documents (workspace_id, file_path, content, updated_at) VALUES (?, ?, ?, ?)')
      .run('semantic-test', 'src/search.ts', 'semantic search enabled', Date.now())
    expect(db.prepare('SELECT file_path FROM semantic_documents_fts WHERE semantic_documents_fts MATCH ? AND workspace_id = ?')
      .get('semantic*', 'semantic-test')).toEqual({ file_path: 'src/search.ts' })

    const workspaceColumns = db.prepare("PRAGMA table_info('workspaces')").all() as Array<{ name: string }>
    expect(workspaceColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'editor_visible',
        'editor_expanded',
        'editor_width_percent',
        'theme_id',
        'ui_density',
        'layout_preset',
        'github_panel_visible',
        'github_panel_expanded',
        'github_panel_width_percent',
        'background_panel_visible',
        'background_panel_expanded',
        'background_panel_width_percent',
        'worktree_panel_visible',
        'worktree_panel_expanded',
        'worktree_panel_width_percent',
        'sort_order'
      ])
    )

    const paneColumns = db.prepare("PRAGMA table_info('panes')").all() as Array<{ name: string }>
    expect(paneColumns.map((column) => column.name)).not.toContain('model_override')
    expect(paneColumns.map((column) => column.name)).toContain('root_path')

    const mcpColumns = db.prepare("PRAGMA table_info('mcp_servers')").all() as Array<{ name: string }>
    expect(mcpColumns.map((column) => column.name)).toContain('trusted')

    const profiles = db
      .prepare('SELECT id, name, executable, args_json FROM shell_profiles ORDER BY id')
      .all() as Array<{ id: string; name: string; executable: string; args_json: string }>
    // builtin-powershell is present on every host: migration 046 repoints
    // references away from it on POSIX but deliberately keeps the row so the
    // foreign keys stay valid and a DB moved back to Windows is repairable.
    expect(profiles.map((profile) => profile.id)).toEqual([
      'builtin-antigravity',
      ...(IS_WINDOWS ? [] : ['builtin-bash']),
      'builtin-claude',
      'builtin-codex',
      'builtin-copilot',
      'builtin-cursor',
      'builtin-grok',
      'builtin-powershell'
    ])
    expect(profiles.find((profile) => profile.id === NEUTRAL_SHELL_ID)).toEqual(
      expect.objectContaining(
        IS_WINDOWS
          ? { name: 'PowerShell', executable: 'powershell.exe', args_json: '["-NoLogo"]' }
          : { name: 'Bash', executable: '/bin/bash', args_json: '["-l"]' }
      )
    )
    // The copilot profile wraps a shell, so its executable follows the platform.
    expect(profiles.find((profile) => profile.id === 'builtin-copilot')).toEqual(
      expect.objectContaining(
        IS_WINDOWS
          ? { name: 'copilot shell', executable: 'powershell.exe', args_json: '["-NoLogo"]' }
          : { name: 'copilot shell', executable: '/bin/bash', args_json: '[]' }
      )
    )
    expect(profiles.find((profile) => profile.id === 'builtin-cursor')).toEqual(
      expect.objectContaining({ executable: 'cursor-agent', args_json: '[]' })
    )

    const agents = db.prepare('SELECT provider, command FROM agent_profiles WHERE is_builtin = 1 ORDER BY provider').all()
    expect(agents).toEqual([
      { provider: 'antigravity', command: 'agy' },
      { provider: 'claude',      command: 'claude' },
      { provider: 'codex',       command: 'codex' },
      { provider: 'copilot',     command: 'copilot' },
      { provider: 'cursor',      command: 'cursor-agent' },
      { provider: 'grok',        command: 'grok' }
    ])

    db.close()
  })
})
