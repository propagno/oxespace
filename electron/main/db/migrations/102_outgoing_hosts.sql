-- F11 outgoing hosts proxy (1.5.0 A68 / H4, SECURITY S1–S6, ccr-f11-release.md §A68):
-- off by default; stores only (host, port, conversation_id, count, first_seen, last_seen), never paths, queries,
-- headers, bodies or credentials; widens person_action_audit with hosts-proxy-on, hosts-proxy-off, hosts-proxy-clear.
CREATE TABLE IF NOT EXISTS outgoing_hosts_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS outgoing_hosts (
  host TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port >= 1 AND port <= 65535),
  conversation_id TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL CHECK (count >= 1),
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY (host, port, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_outgoing_hosts_last_seen ON outgoing_hosts(last_seen DESC);

DROP TABLE IF EXISTS person_action_audit_new;
CREATE TABLE person_action_audit_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'place-read',
    'place-switch-back',
    'place-undo',
    'place-restore',
    'place-discard',
    'worktree-remove',
    'branch-delete',
    'preview-grant',
    'preview-end',
    'android-agents-can-see',
    'thread-branch',
    'hosts-proxy-on',
    'hosts-proxy-off',
    'hosts-proxy-clear'
  )),
  thread_id TEXT,
  place_id TEXT,
  target TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'refused', 'error')),
  code TEXT
);
INSERT INTO person_action_audit_new (id, ts, actor, action, thread_id, place_id, target, outcome, code)
  SELECT id, ts, actor, action, thread_id, place_id, target, outcome, code FROM person_action_audit;
DROP TABLE person_action_audit;
ALTER TABLE person_action_audit_new RENAME TO person_action_audit;
CREATE INDEX IF NOT EXISTS idx_person_action_audit_ts ON person_action_audit(ts DESC);
CREATE TRIGGER IF NOT EXISTS person_action_audit_no_update BEFORE UPDATE ON person_action_audit
BEGIN SELECT RAISE(ABORT, 'person_action_audit is append-only'); END;

PRAGMA user_version = 102;
