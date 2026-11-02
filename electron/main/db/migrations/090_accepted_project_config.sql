-- B7.4 · The last version of each gated policy file the person accepted, so an outside change applies only once they accept it.
-- `subject` is `project:<trustKey>` (the repository folder, as RepoHookTrust keys it), `user` or `managed`; `file` is
-- `policy` (.oxespace/policy.json, or the user/managed policy.json) or `oxe.yaml` (its tool group modes only).
-- `projection_json` is the accepted security projection (rules in order, or the group modes; `absent`/`invalid` too),
-- `projection_hash` its SHA-256. `intent_hash` is an app write that is about to land (set before the rename, promoted
-- after it). `rejected_hash` is a version the person kept out ("Keep the accepted rules"); it is not asked again.
CREATE TABLE IF NOT EXISTS accepted_project_config (
  subject TEXT NOT NULL,
  file TEXT NOT NULL CHECK (file IN ('policy', 'oxe.yaml')),
  projection_hash TEXT NOT NULL,
  projection_json TEXT NOT NULL,
  intent_hash TEXT,
  rejected_hash TEXT,
  accepted_via TEXT NOT NULL CHECK (accepted_via IN ('app-write', 'person-confirmed', 'narrowed', 'baseline-default', 'inherited')),
  accepted_at INTEGER NOT NULL CHECK (accepted_at >= 0),
  PRIMARY KEY (subject, file)
);

PRAGMA user_version = 90;
