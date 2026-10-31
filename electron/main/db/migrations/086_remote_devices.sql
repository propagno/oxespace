-- Remote gateway (B9, M1–M3): the phones paired with this desktop, the gateway's own settings and secrets, and an
-- append-only trail of what happened on it.
--
-- A device keeps only its name and its EC P-256 public key (SubjectPublicKeyInfo DER): its private key never leaves
-- the phone. A revoked device stays as a row, so its tokens and refreshes keep being refused as `revoked`.
CREATE TABLE IF NOT EXISTS remote_devices (
  device_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public_key_spki BLOB NOT NULL,
  paired_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_remote_devices_active ON remote_devices(revoked, paired_at);

-- One row. The certificate DER is public; its private key is stored only as `safeStorage` ciphertext. The
-- access-token signing key is never stored: it is made at each launch and kept in memory. Whether the gateway is on
-- is never stored either: it starts off on every launch. `desktop_name` is the name phones see; NULL means the
-- default ("OXESpace"), never the host name.
CREATE TABLE IF NOT EXISTS remote_gateway (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  port INTEGER NOT NULL DEFAULT 47321,
  certificate_der BLOB,
  certificate_key BLOB,
  desktop_name TEXT,
  updated_at INTEGER NOT NULL
);

-- Gateway on/off, pairing, revocation, renames and authentication failures. No tokens, codes, keys or signatures.
CREATE TABLE IF NOT EXISTS remote_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL,
  device_id TEXT,
  remote_address TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_remote_audit_ts ON remote_audit(ts DESC);

CREATE TRIGGER IF NOT EXISTS remote_audit_no_update BEFORE UPDATE ON remote_audit
BEGIN SELECT RAISE(ABORT, 'remote_audit is append-only'); END;

PRAGMA user_version = 86;
