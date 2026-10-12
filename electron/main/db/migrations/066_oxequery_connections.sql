-- OxeQuery saved database connections. The password is NOT stored here: it lives
-- in secure_credentials under the key "oxequery:<id>" (safeStorage), and this
-- table only records whether one exists.
CREATE TABLE IF NOT EXISTS oxequery_connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  engine TEXT NOT NULL CHECK(engine IN ('postgres', 'mongodb')),
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  database_name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  ssl_mode TEXT NOT NULL DEFAULT 'disable' CHECK(ssl_mode IN ('disable', 'prefer', 'require')),
  read_only INTEGER NOT NULL DEFAULT 1,
  environment TEXT NOT NULL DEFAULT 'local' CHECK(environment IN ('local', 'dev', 'prod')),
  container_ref TEXT,
  has_password INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

PRAGMA user_version = 66;
