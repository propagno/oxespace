PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agent_profiles (
  agent_profile_id TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  provider         TEXT NOT NULL,
  command          TEXT NOT NULL,
  command_template TEXT NOT NULL,
  model            TEXT,
  role             TEXT,
  is_builtin       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_readiness_cache (
  provider   TEXT PRIMARY KEY,
  status     TEXT NOT NULL,
  version    TEXT,
  details    TEXT,
  checked_at INTEGER NOT NULL
);

PRAGMA user_version = 3;
