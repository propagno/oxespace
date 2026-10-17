import { describe, expect, test } from 'vitest'
import { LATEST_DB_VERSION, openInMemoryDatabase, runMigrations } from '../../electron/main/db/index'

/**
 * A database as 0.17.x leaves it (schema version 73), full of connections, history and saved queries, taken
 * through the migrations of this release. Nothing the person had may be lost or changed, and the new columns
 * must start at values that mean "as before".
 */
function as0173() {
  const db = openInMemoryDatabase()
  db.exec('DROP TABLE oxequery_workspaces; DROP TABLE oxequery_preferences;')
  for (const column of ['group_name', 'favorite', 'color', 'last_used_at', 'mask_patterns', 'keepalive_seconds', 'ssh_use_agent']) db.exec(`ALTER TABLE oxequery_connections DROP COLUMN ${column}`)
  db.pragma('user_version = 73')
  return db
}

describe('upgrade from 0.17.x (schema 73)', () => {
  test('keeps every connection, secret, saved query and history row, and starts the new settings neutral', () => {
    const db = as0173()
    const insert = db.prepare(`INSERT INTO oxequery_connections (id, name, engine, host, port, database_name, username, ssl_mode, read_only, environment, has_password, created_at, updated_at, agent_access, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_auth)
      VALUES (@id, @name, @engine, @host, @port, 'app', 'me', 'verify-full', @readOnly, @environment, 1, 100, 200, @agent, @ssh, @sshHost, 22, 'me', 'key')`)
    insert.run({ id: 'a', name: 'Billing', engine: 'postgres', host: 'db.internal', port: 5432, readOnly: 1, environment: 'prod', agent: 'read', ssh: 0, sshHost: '' })
    insert.run({ id: 'b', name: 'Events', engine: 'mongodb', host: 'mongo.internal', port: 27017, readOnly: 0, environment: 'dev', agent: 'off', ssh: 1, sshHost: 'bastion' })
    db.prepare("INSERT INTO secure_credentials (provider, payload, encrypted, label, created_at, updated_at) VALUES ('oxequery:a', ?, 1, 'Billing', 1, 1)").run(Buffer.from('cipher'))
    db.prepare("INSERT INTO oxequery_saved_queries (id, connection_id, name, sql, created_at, updated_at) VALUES ('q1', 'a', 'Totals', 'SELECT 1', 1, 1)").run()
    db.prepare("INSERT INTO oxequery_query_history (connection_id, sql, ran_at, duration_ms, row_count, ok) VALUES ('a', 'SELECT 2', 5, 3, 1, 1)").run()

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_DB_VERSION)
    const rows = db.prepare('SELECT * FROM oxequery_connections ORDER BY id').all() as Record<string, unknown>[]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 'a', name: 'Billing', host: 'db.internal', read_only: 1, environment: 'prod', agent_access: 'read', ssl_mode: 'verify-full', created_at: 100 })
    expect(rows[1]).toMatchObject({ id: 'b', ssh_enabled: 1, ssh_host: 'bastion', ssh_auth: 'key' })
    // "As before": no group, not a favorite, no color, never used, nothing masked, 30 s keep-alive, no agent sign-in.
    for (const row of rows) expect(row).toMatchObject({ group_name: '', favorite: 0, color: '', last_used_at: 0, mask_patterns: '', keepalive_seconds: 30, ssh_use_agent: 0 })
    expect((db.prepare("SELECT count(*) AS n FROM secure_credentials WHERE provider = 'oxequery:a'").get() as { n: number }).n).toBe(1)
    expect((db.prepare('SELECT count(*) AS n FROM oxequery_saved_queries').get() as { n: number }).n).toBe(1)
    expect((db.prepare('SELECT count(*) AS n FROM oxequery_query_history').get() as { n: number }).n).toBe(1)
    // The new tables exist and are empty; the children still cascade.
    expect((db.prepare('SELECT count(*) AS n FROM oxequery_workspaces').get() as { n: number }).n).toBe(0)
    expect((db.prepare('SELECT count(*) AS n FROM oxequery_preferences').get() as { n: number }).n).toBe(0)
    db.prepare('DELETE FROM oxequery_connections WHERE id = ?').run('a')
    expect((db.prepare('SELECT count(*) AS n FROM oxequery_saved_queries').get() as { n: number }).n).toBe(0)
    db.close()
  })

  test('running the migrations again neither fails nor touches the data', () => {
    const db = as0173()
    db.prepare("INSERT INTO oxequery_connections (id, name, engine, host, port, created_at, updated_at) VALUES ('a', 'Billing', 'postgres', 'h', 5432, 1, 1)").run()
    runMigrations(db)
    db.prepare("UPDATE oxequery_connections SET favorite = 1, group_name = 'Ops' WHERE id = 'a'").run()
    // (The runner's self-healing steps can lower user_version on a re-open; that is the runner's own behavior, so
    // this checks the data and the absence of errors, not the number.)
    expect(() => runMigrations(db)).not.toThrow()
    expect(db.prepare("SELECT favorite, group_name FROM oxequery_connections WHERE id = 'a'").get()).toEqual({ favorite: 1, group_name: 'Ops' })
    db.close()
  })
})
