-- Durable projections for worktree delegation. The JSON payload remains the
-- compatibility source while indexed columns make recovery/listing bounded.
CREATE INDEX IF NOT EXISTS delegation_destination_execution ON delegations(json_extract(payload, '$.destinationExecutionId'));
CREATE INDEX IF NOT EXISTS delegation_destination_thread ON delegations(json_extract(payload, '$.destinationThreadId'));
CREATE INDEX IF NOT EXISTS delegation_destination_pane ON delegations(json_extract(payload, '$.paneId'));
CREATE INDEX IF NOT EXISTS delegation_origin_execution ON delegations(origin_execution);
CREATE TABLE IF NOT EXISTS delegation_task_index (
  task_id TEXT PRIMARY KEY REFERENCES delegations(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  origin_workspace_id TEXT,
  project TEXT NOT NULL,
  state TEXT NOT NULL,
  branch TEXT NOT NULL,
  objective TEXT NOT NULL,
  surface TEXT NOT NULL DEFAULT 'terminal',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS delegation_task_workspace_updated
  ON delegation_task_index(workspace_id, updated_at DESC, task_id);
CREATE INDEX IF NOT EXISTS delegation_task_origin_workspace_updated
  ON delegation_task_index(origin_workspace_id, updated_at DESC, task_id);
CREATE INDEX IF NOT EXISTS delegation_task_project_state
  ON delegation_task_index(project, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS delegation_task_branch
  ON delegation_task_index(project, branch);

CREATE TABLE IF NOT EXISTS delegation_checkouts (
  task_id TEXT PRIMARY KEY REFERENCES delegations(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL DEFAULT 1,
  strategy TEXT NOT NULL CHECK(strategy IN ('existing', 'create', 'generated')),
  requested_json TEXT NOT NULL,
  resolved_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS delegation_session_bindings (
  task_id TEXT PRIMARY KEY REFERENCES delegations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('claude', 'codex')),
  native_session_id TEXT NOT NULL,
  canonical_root TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation > 0),
  resumable INTEGER NOT NULL DEFAULT 1 CHECK(resumable IN (0, 1)),
  observed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, native_session_id, canonical_root)
);
CREATE INDEX IF NOT EXISTS delegation_session_root
  ON delegation_session_bindings(canonical_root, updated_at DESC);

CREATE TABLE IF NOT EXISTS delegation_handoff_revisions (
  task_id TEXT NOT NULL REFERENCES delegations(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision > 0),
  bundle_json TEXT NOT NULL,
  bundle_sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(task_id, revision)
);

CREATE TABLE IF NOT EXISTS delegation_operation_journal (
  task_id TEXT NOT NULL REFERENCES delegations(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation > 0),
  state TEXT NOT NULL CHECK(state IN ('requested', 'running', 'succeeded', 'failed', 'unknown')),
  receipt_json TEXT,
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  PRIMARY KEY(task_id, operation, generation)
);
CREATE INDEX IF NOT EXISTS delegation_operation_state
  ON delegation_operation_journal(state, started_at DESC);

INSERT OR REPLACE INTO delegation_task_index(
  task_id, workspace_id, origin_workspace_id, project, state, branch,
  objective, surface, created_at, updated_at
)
SELECT
  id,
  workspace_id,
  json_extract(payload, '$.originWorkspaceId'),
  COALESCE(json_extract(payload, '$.project'), ''),
  COALESCE(json_extract(payload, '$.state'), 'interrupted'),
  COALESCE(json_extract(payload, '$.branch'), ''),
  COALESCE(json_extract(payload, '$.objective'), ''),
  COALESCE(json_extract(payload, '$.surface'), 'terminal'),
  COALESCE(json_extract(payload, '$.createdAt'), 0),
  COALESCE(json_extract(payload, '$.updatedAt'), 0)
FROM delegations;

INSERT OR IGNORE INTO delegation_checkouts(
  task_id, schema_version, strategy, requested_json, resolved_json, created_at, updated_at
)
SELECT
  id,
  1,
  COALESCE(json_extract(payload, '$.branchIntent.strategy'), 'generated'),
  COALESCE(json_extract(payload, '$.branchIntent'), '{"strategy":"generated"}'),
  json_object(
    'strategy', COALESCE(json_extract(payload, '$.branchIntent.strategy'), 'generated'),
    'branch', COALESCE(json_extract(payload, '$.branch'), ''),
    'baseRef', COALESCE(json_extract(payload, '$.baseSha'), ''),
    'baseSha', COALESCE(json_extract(payload, '$.baseSha'), ''),
    'path', COALESCE(json_extract(payload, '$.path'), ''),
    'createBranch', 1,
    'reuseExistingWorktree', 0,
    'fetchBase', 0,
    'resolvedAt', COALESCE(json_extract(payload, '$.createdAt'), 0)
  ),
  COALESCE(json_extract(payload, '$.createdAt'), 0),
  COALESCE(json_extract(payload, '$.updatedAt'), 0)
FROM delegations;

CREATE TRIGGER IF NOT EXISTS delegation_index_after_insert
AFTER INSERT ON delegations BEGIN
  INSERT INTO delegation_task_index(
    task_id, workspace_id, origin_workspace_id, project, state, branch,
    objective, surface, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.workspace_id, json_extract(NEW.payload, '$.originWorkspaceId'),
    COALESCE(json_extract(NEW.payload, '$.project'), ''),
    COALESCE(json_extract(NEW.payload, '$.state'), 'interrupted'),
    COALESCE(json_extract(NEW.payload, '$.branch'), ''),
    COALESCE(json_extract(NEW.payload, '$.objective'), ''),
    COALESCE(json_extract(NEW.payload, '$.surface'), 'terminal'),
    COALESCE(json_extract(NEW.payload, '$.createdAt'), 0),
    COALESCE(json_extract(NEW.payload, '$.updatedAt'), 0)
  ) ON CONFLICT(task_id) DO UPDATE SET
    workspace_id = excluded.workspace_id,
    origin_workspace_id = excluded.origin_workspace_id,
    project = excluded.project,
    state = excluded.state,
    branch = excluded.branch,
    objective = excluded.objective,
    surface = excluded.surface,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER IF NOT EXISTS delegation_index_after_update
AFTER UPDATE OF payload, workspace_id ON delegations BEGIN
  INSERT INTO delegation_task_index(
    task_id, workspace_id, origin_workspace_id, project, state, branch,
    objective, surface, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.workspace_id, json_extract(NEW.payload, '$.originWorkspaceId'),
    COALESCE(json_extract(NEW.payload, '$.project'), ''),
    COALESCE(json_extract(NEW.payload, '$.state'), 'interrupted'),
    COALESCE(json_extract(NEW.payload, '$.branch'), ''),
    COALESCE(json_extract(NEW.payload, '$.objective'), ''),
    COALESCE(json_extract(NEW.payload, '$.surface'), 'terminal'),
    COALESCE(json_extract(NEW.payload, '$.createdAt'), 0),
    COALESCE(json_extract(NEW.payload, '$.updatedAt'), 0)
  ) ON CONFLICT(task_id) DO UPDATE SET
    workspace_id = excluded.workspace_id,
    origin_workspace_id = excluded.origin_workspace_id,
    project = excluded.project,
    state = excluded.state,
    branch = excluded.branch,
    objective = excluded.objective,
    surface = excluded.surface,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER IF NOT EXISTS delegation_index_after_delete
AFTER DELETE ON delegations BEGIN
  DELETE FROM delegation_task_index WHERE task_id = OLD.id;
END;

PRAGMA user_version = 57;
