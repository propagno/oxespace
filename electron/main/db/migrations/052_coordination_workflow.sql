CREATE TABLE IF NOT EXISTS coordination_routes (
  origin_project TEXT NOT NULL, target_project TEXT NOT NULL,
  target_workspace TEXT NOT NULL, expires_at INTEGER NOT NULL,
  allow_evidence INTEGER NOT NULL DEFAULT 0 CHECK (allow_evidence IN (0, 1)),
  PRIMARY KEY(origin_project, target_workspace)
);
CREATE TABLE IF NOT EXISTS coordination_requests (
  origin_pane TEXT NOT NULL, request_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL, task_id TEXT NOT NULL REFERENCES delegations(id),
  PRIMARY KEY(origin_pane, request_key)
);
CREATE TABLE IF NOT EXISTS coordination_receipts (
  task_id TEXT NOT NULL REFERENCES delegations(id),
  stage TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(task_id, stage)
);
CREATE TABLE IF NOT EXISTS coordination_results (
  task_id TEXT NOT NULL REFERENCES delegations(id),
  revision INTEGER NOT NULL CHECK(revision > 0), text TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(task_id, revision)
);
CREATE TABLE IF NOT EXISTS coordination_subscriptions (
  participant_id TEXT PRIMARY KEY REFERENCES coordination_participants(id),
  cursor INTEGER NOT NULL DEFAULT 0 CHECK(cursor >= 0)
);
PRAGMA user_version = 52;
