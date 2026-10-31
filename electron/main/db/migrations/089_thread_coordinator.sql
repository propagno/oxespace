-- The project's coordinator conversation (B1.4), chosen by the person. One row per project, so a project has at
-- most one; marking another conversation replaces the row. A conversation coordinates at most one project, and
-- deleting it or its project removes the row. B1's range in the 1.4 numbering is 084–089: renumber this file and
-- its runner line at merge if another B1 migration lands first.
CREATE TABLE IF NOT EXISTS thread_project_coordinators (
  project_id TEXT PRIMARY KEY REFERENCES thread_projects(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL UNIQUE REFERENCES conversation_threads(id) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL
);

PRAGMA user_version = 89;
