-- Additive metadata: delegations remains the source of task lifecycle truth.
-- No execution tokens, automatic adoption or cross-project grants are migrated.
CREATE TABLE IF NOT EXISTS coordination_scopes (
  task_id TEXT PRIMARY KEY REFERENCES delegations(id),
  origin_workspace_id TEXT NOT NULL,
  origin_project_id TEXT NOT NULL,
  target_workspace_id TEXT NOT NULL,
  target_project_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
);
CREATE TABLE IF NOT EXISTS coordination_participants (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES coordination_scopes(task_id),
  role TEXT NOT NULL CHECK (role IN ('requester', 'executor', 'observer')),
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS coordination_single_owner
  ON coordination_participants(task_id, role) WHERE role IN ('requester', 'executor');

INSERT OR IGNORE INTO coordination_scopes
  (task_id, origin_workspace_id, origin_project_id, target_workspace_id, target_project_id)
SELECT id, workspace_id, json_extract(payload, '$.project'), workspace_id, json_extract(payload, '$.project')
FROM delegations WHERE json_valid(payload) AND json_type(payload, '$.project') = 'text';

INSERT OR IGNORE INTO coordination_participants(id, task_id, role, workspace_id, project_id)
SELECT 'legacy-requester:' || task_id, task_id, 'requester', origin_workspace_id, origin_project_id
FROM coordination_scopes;
INSERT OR IGNORE INTO coordination_participants(id, task_id, role, workspace_id, project_id)
SELECT 'legacy-executor:' || task_id, task_id, 'executor', target_workspace_id, target_project_id
FROM coordination_scopes;
PRAGMA user_version = 50;
