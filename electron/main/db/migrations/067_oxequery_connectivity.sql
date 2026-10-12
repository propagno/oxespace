-- OxeQuery connectivity: verified TLS, SSH tunnels, MongoDB options, per-connection
-- limits and the agent access level.
--
-- ssl_mode gains verify-ca / verify-full and SQLite cannot alter a CHECK
-- constraint, so the table is rebuilt. Every old column is carried over, which
-- also makes a replay of this step harmless.
--
-- Secrets stay in secure_credentials:
--   oxequery:<id>        database password
--   oxequery:<id>:ca     CA certificate (PEM)
--   oxequery:<id>:cert   client certificate (PEM)
--   oxequery:<id>:key    client private key (PEM)
--   oxequery:<id>:ssh    JSON { password | privateKey, passphrase }
CREATE TABLE IF NOT EXISTS oxequery_connections_v2 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  engine TEXT NOT NULL CHECK(engine IN ('postgres', 'mongodb')),
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  database_name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  ssl_mode TEXT NOT NULL DEFAULT 'disable' CHECK(ssl_mode IN ('disable', 'prefer', 'require', 'verify-ca', 'verify-full')),
  read_only INTEGER NOT NULL DEFAULT 1,
  environment TEXT NOT NULL DEFAULT 'local' CHECK(environment IN ('local', 'dev', 'prod')),
  container_ref TEXT,
  has_password INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  has_ca INTEGER NOT NULL DEFAULT 0,
  has_client_cert INTEGER NOT NULL DEFAULT 0,
  auth_source TEXT NOT NULL DEFAULT '',
  replica_set TEXT NOT NULL DEFAULT '',
  direct_connection INTEGER NOT NULL DEFAULT 1,
  use_srv INTEGER NOT NULL DEFAULT 0,
  extra_hosts TEXT NOT NULL DEFAULT '',
  ssh_enabled INTEGER NOT NULL DEFAULT 0,
  ssh_host TEXT NOT NULL DEFAULT '',
  ssh_port INTEGER NOT NULL DEFAULT 22,
  ssh_user TEXT NOT NULL DEFAULT '',
  ssh_auth TEXT NOT NULL DEFAULT 'key' CHECK(ssh_auth IN ('key', 'password')),
  has_ssh_secret INTEGER NOT NULL DEFAULT 0,
  ssh_key_name TEXT NOT NULL DEFAULT '',
  statement_timeout_ms INTEGER NOT NULL DEFAULT 60000,
  max_rows INTEGER NOT NULL DEFAULT 500,
  agent_access TEXT NOT NULL DEFAULT 'off' CHECK(agent_access IN ('off', 'read', 'write'))
);

INSERT OR REPLACE INTO oxequery_connections_v2
  (id, name, engine, host, port, database_name, username, ssl_mode, read_only, environment, container_ref, has_password, created_at, updated_at)
SELECT id, name, engine, host, port, database_name, username, ssl_mode, read_only, environment, container_ref, has_password, created_at, updated_at
FROM oxequery_connections;

DROP TABLE oxequery_connections;
ALTER TABLE oxequery_connections_v2 RENAME TO oxequery_connections;

-- Host keys the user has trusted for SSH tunnels. A different key for a known
-- host is a hard failure, never a prompt.
CREATE TABLE IF NOT EXISTS oxequery_known_hosts (
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  PRIMARY KEY (host, port)
);

PRAGMA user_version = 67;
