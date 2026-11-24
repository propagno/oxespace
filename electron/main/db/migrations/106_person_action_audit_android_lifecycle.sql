-- OXE-111: widens person_action_audit's action CHECK with android-avd-start, android-apk-install,
-- android-app-launch and android-logcat-tail (MCP Android lifecycle actions with consent/audit),
-- keeping every action 103 accepts, every existing row, the index and the append-only trigger.
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
    'hosts-proxy-clear',
    'android-install-apk',
    'android-open-link',
    'android-pair-link',
    'android-avd-start',
    'android-apk-install',
    'android-app-launch',
    'android-logcat-tail'
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

PRAGMA user_version = 106;
