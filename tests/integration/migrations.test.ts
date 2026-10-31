import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { LATEST_DB_VERSION, openInMemoryDatabase, runMigrations } from '../../electron/main/db/index'

// Literal on purpose: it verifies the migration SQL itself sets this version,
// independently of the runner's constant. Bump both when adding a migration.
const EXPECTED_SCHEMA_VERSION = 89

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
  test('detaches existing conversations and children from Code workspace deletion', () => {
    const db = openInMemoryDatabase()
    try {
      db.pragma('foreign_keys = OFF')
      db.exec(`DROP TABLE conversation_threads; DROP TABLE thread_project_contexts; DROP TABLE thread_projects;
        CREATE TABLE conversation_threads (
          id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          data_json TEXT NOT NULL, events_json TEXT NOT NULL DEFAULT '[]', history_version INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_conversation_threads_workspace ON conversation_threads(workspace_id);
        PRAGMA user_version = 58;`)
      db.pragma('foreign_keys = ON')
      db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('code', 'Repo', '/repo', '1x1', 'builtin-claude')").run()
      const thread = { id: 'conversation', workspaceId: 'code', projectId: 'memory-project', rootPath: '/repo', provider: 'codex', nativeSessionId: 'native-session' }
      db.prepare('INSERT INTO conversation_threads (id, workspace_id, data_json, events_json) VALUES (?, ?, ?, ?)').run(thread.id, 'code', JSON.stringify(thread), '[]')
      db.prepare('INSERT INTO conversation_events (thread_id, seq, data_json) VALUES (?, ?, ?)').run(thread.id, 1, '{"type":"message","role":"user","text":"hello"}')
      db.prepare('INSERT INTO conversation_operations (id, thread_id, generation, kind, state, created_at, updated_at) VALUES (?, ?, 1, ?, ?, 1, 1)').run('operation', thread.id, 'turn', 'completed')
      db.prepare('INSERT INTO conversation_checkpoints (id, thread_id, root_path, state, created_at) VALUES (?, ?, ?, ?, 1)').run('checkpoint', thread.id, '/repo', 'ready')
      runMigrations(db)
      expect(db.pragma('foreign_key_check')).toEqual([])
      expect(db.prepare('SELECT thread_project_id FROM conversation_threads WHERE id = ?').get(thread.id)).toEqual({ thread_project_id: 'memory-project' })
      db.prepare("DELETE FROM workspaces WHERE id = 'code'").run()
      expect(db.prepare('SELECT id FROM conversation_threads').all()).toEqual([{ id: thread.id }])
      expect(db.prepare('SELECT thread_id, seq FROM conversation_events').all()).toEqual([{ thread_id: thread.id, seq: 1 }])
      expect(db.prepare('SELECT id FROM conversation_operations').all()).toEqual([{ id: 'operation' }])
      expect(db.prepare('SELECT id FROM conversation_checkpoints').all()).toEqual([{ id: 'checkpoint' }])
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally { db.close() }
  })

  test('adopts Workbench once for existing workspaces and preserves later choices', () => {
    const db = openInMemoryDatabase()
    try {
      db.prepare("INSERT INTO workspaces (id, name, root_path, layout, theme_id, default_shell_profile_id) VALUES ('legacy', 'Legacy', '/tmp/legacy', '1x1', 'dracula', 'builtin-powershell')").run()
      // A real version-57 database predates migration 065. Rewinding the number alone would leave a
      // current schema behind, which the runner treats as already past the adoption (an old build left
      // exactly that state), so the 065 column is removed to match what a genuine file looks like.
      db.exec('DROP INDEX IF EXISTS conversation_events_rev')
      db.exec('ALTER TABLE conversation_threads DROP COLUMN epoch')
      db.pragma('user_version = 57')
      runMigrations(db)
      expect(db.prepare("SELECT theme_id FROM workspaces WHERE id = 'legacy'").get()).toEqual({ theme_id: 'midnight' })
      db.prepare("UPDATE workspaces SET theme_id = 'nord' WHERE id = 'legacy'").run()
      expect(db.pragma('user_version', { simple: true })).toBe(EXPECTED_SCHEMA_VERSION)
      expect(db.prepare("SELECT theme_id FROM workspaces WHERE id = 'legacy'").get()).toEqual({ theme_id: 'nord' })
      runMigrations(db)
      expect(db.prepare("SELECT theme_id FROM workspaces WHERE id = 'legacy'").get()).toEqual({ theme_id: 'nord' })
    } finally { db.close() }
  })

  test('migration 057 indexes legacy delegation payloads without losing their checkout', () => {
    const db = openInMemoryDatabase()
    try {
      db.exec(`
        DROP TRIGGER delegation_index_after_insert;
        DROP TRIGGER delegation_index_after_update;
        DROP TRIGGER delegation_index_after_delete;
        DROP TABLE delegation_operation_journal;
        DROP TABLE delegation_handoff_revisions;
        DROP TABLE delegation_session_bindings;
        DROP TABLE delegation_checkouts;
        DROP TABLE delegation_task_index;
        PRAGMA user_version = 56;
      `)
      const payload = { id: 'legacy-task', key: 'legacy-key', originExecutionId: 'origin', workspaceId: 'workspace', project: 'project',
        state: 'interrupted', branch: 'oxe/legacy-12345678', objective: 'Legacy task', path: '/repo-worktrees/legacy', baseSha: 'abc', createdAt: 10, updatedAt: 20 }
      db.prepare('INSERT INTO delegations(id, origin_execution, request_key, workspace_id, payload) VALUES(?, ?, ?, ?, ?)')
        .run(payload.id, payload.originExecutionId, payload.key, payload.workspaceId, JSON.stringify(payload))
      runMigrations(db)
      expect(db.pragma('user_version', { simple: true })).toBe(EXPECTED_SCHEMA_VERSION)
      expect(db.prepare('SELECT project, state, branch FROM delegation_task_index WHERE task_id = ?').get(payload.id))
        .toEqual({ project: 'project', state: 'interrupted', branch: 'oxe/legacy-12345678' })
      const checkout = db.prepare('SELECT strategy, resolved_json AS resolved FROM delegation_checkouts WHERE task_id = ?').get(payload.id) as { strategy: string; resolved: string }
      expect(checkout.strategy).toBe('generated')
      expect(JSON.parse(checkout.resolved)).toMatchObject({ branch: payload.branch, path: payload.path, baseSha: payload.baseSha })
    } finally { db.close() }
  })

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
        'semantic_documents_fts',
        'conversation_event_envelopes',
        'conversation_operations',
        'conversation_checkpoints',
        'conversation_checkpoint_files',
        'delegation_task_index',
        'delegation_checkouts',
        'delegation_session_bindings',
        'delegation_handoff_revisions',
        'delegation_operation_journal',
        'activity_entries',
        'activity_state'
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

describe('migration 088 (nested conversations)', () => {
  type Db = ReturnType<typeof openInMemoryDatabase>
  /** A real version-83 file: conversation_threads without the parent columns, rebuilt the way SQLite documents. */
  function atVersion83(): Db {
    const db = openInMemoryDatabase()
    db.pragma('foreign_keys = OFF')
    const table = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'conversation_threads'").get() as { sql: string }).sql
    const indexes = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'conversation_threads' AND sql IS NOT NULL AND name <> 'idx_conversation_threads_parent'").all() as { sql: string }[]).map(row => row.sql)
    const columns = (db.prepare("PRAGMA table_info('conversation_threads')").all() as { name: string }[]).map(column => column.name).filter(name => !name.startsWith('parent_'))
    const v83 = table.replace(/,\s*parent_thread_id TEXT REFERENCES conversation_threads\(id\) ON DELETE SET NULL/i, '').replace(/,\s*parent_via TEXT CHECK\(parent_via IN \([^)]*\)\)/i, '')
      .replace('conversation_threads', 'conversation_threads_v83')
    expect(v83).not.toContain('parent_')
    db.exec(`DROP INDEX idx_conversation_threads_parent; ${v83};
      INSERT INTO conversation_threads_v83 (${columns.join(', ')}) SELECT ${columns.join(', ')} FROM conversation_threads;
      DROP TABLE conversation_threads; ALTER TABLE conversation_threads_v83 RENAME TO conversation_threads; ${indexes.join('; ')};
      PRAGMA user_version = 83;`)
    db.pragma('foreign_keys = ON')
    expect((db.prepare("PRAGMA table_info('conversation_threads')").all() as { name: string }[]).some(column => column.name === 'parent_thread_id')).toBe(false)
    db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws', 'Repo', '/repo', '1x1', 'builtin-claude')").run()
    db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES ('p', '/repo', '/repo', 'Repo', 1, 1)").run()
    return db
  }
  const thread = (db: Db, id: string) => db.prepare("INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, 'p', ?, ?)")
    .run(id, 'ws', JSON.stringify({ id, workspaceId: 'ws', title: id, status: 'idle' }), '[]')
  const handoff = (db: Db, origin: string, destination: string, at: number) => db.prepare('INSERT INTO mcp_thread_handoffs (origin_thread_id, request_key, destination_thread_id, created_at) VALUES (?, ?, ?, ?)')
    .run(origin, `key-${destination}`, destination, at)
  const work = (db: Db, supervisor: string, worker: string, at: number) => {
    db.prepare("INSERT INTO work_runs (id, supervisor_thread_id, workspace_id, project_id, project_root, request_key, title, status, created_at, updated_at) VALUES (?, ?, 'ws', 'p', '/repo', ?, 'Run', 'running', ?, ?)")
      .run(`run-${worker}`, supervisor, `run-${worker}`, at - 1, at)
    db.prepare("INSERT INTO work_tasks (id, run_id, key, title, prompt, provider, access, status, thread_id, position, started_at) VALUES (?, ?, 'k', 'Task', 'Do it', 'codex', 'read-only', 'running', ?, 0, ?)")
      .run(`task-${worker}`, `run-${worker}`, worker, at)
  }
  const delegation = (db: Db, originPaneId: string, destination: string, at: number) => {
    const payload = { id: `delegation-${destination}`, key: `key-${destination}`, originExecutionId: 'origin', originPaneId, workspaceId: 'ws', project: 'p', state: 'running',
      branch: `oxe/${destination}`, objective: 'Delegated', path: '/repo', baseSha: 'abc', destinationThreadId: destination, createdAt: at, updatedAt: at }
    db.prepare('INSERT INTO delegations (id, origin_execution, request_key, workspace_id, payload) VALUES (?, ?, ?, ?, ?)').run(payload.id, 'origin', payload.key, 'ws', JSON.stringify(payload))
  }
  const parents = (db: Db) => Object.fromEntries((db.prepare('SELECT id, parent_thread_id AS parent, parent_via AS via FROM conversation_threads ORDER BY id').all() as { id: string; parent: string | null; via: string | null }[])
    .map(row => [row.id, row.parent ? `${row.parent}/${row.via}` : null]))

  test('upgrades from 83 and backfills each source, the earliest link winning, never a cycle', () => {
    const db = atVersion83()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const id of ['A', 'B', 'S', 'W', 'D', 'T', 'M', 'Y', 'P1', 'P2', 'P3']) thread(db, id)
      handoff(db, 'A', 'B', 100) // thread_create
      work(db, 'S', 'W', 200) // work
      delegation(db, 'thread:S', 'D', 300) // delegation from a Thread
      delegation(db, 'pane-1', 'T', 300) // delegation from a terminal: no parent
      handoff(db, 'A', 'M', 500); work(db, 'S', 'M', 400) // several candidates: the earliest (work, 400) wins
      work(db, 'B', 'A', 150) // A then B then A: B's parent is already A, so A cannot take B
      delegation(db, 'thread:Y', 'Y', 50) // a conversation as its own parent
      handoff(db, 'P1', 'P2', 10); handoff(db, 'P2', 'P3', 20); handoff(db, 'P3', 'P1', 30) // a longer loop
      work(db, 'S', 'gone', 600) // a worker whose conversation no longer exists
      runMigrations(db)
      expect(db.pragma('user_version', { simple: true })).toBe(EXPECTED_SCHEMA_VERSION)
      expect(parents(db)).toEqual({ A: null, B: 'A/thread_create', D: 'S/delegation', M: 'S/work', P1: null, P2: 'P1/thread_create', P3: 'P2/thread_create', S: null, T: null, W: 'S/work', Y: null })
      expect(warn).toHaveBeenCalledWith('[db] thread parent backfill skipped 3 link(s) that would form a cycle')
      expect(db.pragma('foreign_key_check')).toEqual([])
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_conversation_threads_parent'").get()).toBeTruthy()
      // A replay changes nothing and keeps existing links.
      db.pragma('user_version = 83')
      runMigrations(db)
      expect(parents(db).B).toBe('A/thread_create')
      expect(parents(db).A).toBeNull()
    } finally { warn.mockRestore(); db.close() }
  })

  test('refuses a parent_via outside the contract', () => {
    const db = openInMemoryDatabase()
    try {
      db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws', 'Repo', '/repo', '1x1', 'builtin-claude')").run()
      db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES ('p', '/repo', '/repo', 'Repo', 1, 1)").run()
      thread(db, 'A'); thread(db, 'B')
      expect(() => db.prepare("UPDATE conversation_threads SET parent_thread_id = 'A', parent_via = 'fork' WHERE id = 'B'").run()).toThrow(/CHECK/)
    } finally { db.close() }
  })
})
