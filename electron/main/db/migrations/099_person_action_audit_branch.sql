-- F8 person_action_audit branch action (1.5.0 A30, ccr-f8-agora-history.md §Branch): widens action CHECK with
-- thread-branch while keeping all existing rows from 094 and 097, the index and the append-only trigger.
DROP TABLE IF EXISTS person_action_audit_new;
CREATE TABLE person_action_audit_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('place-read', 'place-switch-back', 'place-undo', 'place-restore', 'place-discard', 'worktree-remove', 'branch-delete', 'preview-grant', 'preview-end', 'android-agents-can-see', 'thread-branch')),
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

PRAGMA user_version = 99;
