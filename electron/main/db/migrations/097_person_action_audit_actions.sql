-- F5 person_action_audit actions (1.5.0 A49, A52, ccr-f5-see-agent.md §S6): widens action CHECK with
-- preview-grant, preview-end and android-agents-can-see while keeping all existing rows, the index and the trigger.
DROP TABLE IF EXISTS person_action_audit_new;
CREATE TABLE person_action_audit_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('place-read', 'place-switch-back', 'place-undo', 'place-restore', 'place-discard', 'worktree-remove', 'branch-delete', 'preview-grant', 'preview-end', 'android-agents-can-see')),
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

PRAGMA user_version = 97;
