-- Task-scoped grants are explicit. Migration grants no access to legacy tasks.
CREATE TABLE IF NOT EXISTS coordination_grants (
  participant_id TEXT NOT NULL REFERENCES coordination_participants(id),
  action TEXT NOT NULL CHECK (action IN ('read', 'message', 'report', 'control')),
  expires_at INTEGER NOT NULL CHECK (expires_at > 0),
  revoked_at INTEGER,
  PRIMARY KEY (participant_id, action)
);
PRAGMA user_version = 51;
