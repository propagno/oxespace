-- Encrypted credential storage for third-party integrations (Linear, …).
-- The payload is produced by Electron's safeStorage (OS keychain / DPAPI); when
-- encryption is unavailable the row is stored plaintext and flagged so the UI
-- can warn instead of silently downgrading.
CREATE TABLE IF NOT EXISTS secure_credentials (
  provider TEXT PRIMARY KEY,
  payload BLOB NOT NULL,
  encrypted INTEGER NOT NULL DEFAULT 1,
  label TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

PRAGMA user_version = 45;
