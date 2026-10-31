-- The project's coordinator conversation (B1.4, S7.5), one concept with the Team's coordinator: one row per project
-- identity (projectIdentity() of thread_projects.root_path, the Team's key), so a repository and its worktrees have at
-- most one. A conversation coordinates at most one identity, and deleting it removes the row. `root_path` is the
-- project root the identity was resolved from: the authority check (thread-coordinator.ts) ignores a row whose project
-- has moved since. The backfill from Team coordinator links needs Git, so it runs in the boot pass, not here.
-- thread_project_coordinators never shipped; dropping it clears development databases that ran the earlier draft.
-- Renumber this file and its runner line at merge if another migration lands first.
DROP TABLE IF EXISTS thread_project_coordinators;
CREATE TABLE IF NOT EXISTS project_coordinators (
  project_identity TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL UNIQUE REFERENCES conversation_threads(id) ON DELETE CASCADE,
  root_path TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

PRAGMA user_version = 89;
