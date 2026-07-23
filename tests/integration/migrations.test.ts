import { describe, expect, test } from 'vitest'
import { LATEST_DB_VERSION, openInMemoryDatabase, runMigrations } from '../../electron/main/db/index'

// Literal on purpose: it verifies the migration SQL itself sets this version,
// independently of the runner's constant. Bump both when adding a migration.
const EXPECTED_SCHEMA_VERSION = 45

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
    expect(profiles.map((profile) => profile.id)).toEqual([
      'builtin-antigravity',
      'builtin-claude',
      'builtin-codex',
      'builtin-copilot',
      'builtin-cursor',
      'builtin-grok',
      'builtin-powershell'
    ])
    expect(profiles.find((profile) => profile.id === 'builtin-powershell')).toEqual(
      expect.objectContaining({
        name: 'PowerShell',
        executable: 'powershell.exe',
        args_json: '["-NoLogo"]'
      })
    )
    expect(profiles.find((profile) => profile.id === 'builtin-copilot')).toEqual(
      expect.objectContaining({
        name: 'copilot shell',
        executable: 'powershell.exe',
        args_json: '["-NoLogo"]'
      })
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
