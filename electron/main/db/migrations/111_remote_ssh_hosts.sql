-- OXE-447 · Unified Remote SSH Hosts registry for OxeCode sidebar.
-- Secrets (passwords or key passphrases) are stored ONLY as safeStorage-encrypted BLOBs.
CREATE TABLE IF NOT EXISTS remote_ssh_hosts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  username TEXT NOT NULL,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('key', 'password', 'agent')),
  key_path TEXT NULL,
  encrypted_secret BLOB NULL,
  pinned_fingerprint TEXT NULL,
  default_remote_dir TEXT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_remote_ssh_hosts_host_port
  ON remote_ssh_hosts(host, port, username);

PRAGMA user_version = 111;
