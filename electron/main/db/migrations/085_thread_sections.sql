-- F13 · Sections of the conversation list, per conversation workspace: `workspace_id` is the same value as
-- conversation_threads.workspace_id, a Code workspace id or `thread:<project id>` for a Thread project.
-- A section goes with that Code workspace or Thread project; an assignment goes with its section and with its
-- conversation. The whole state of a workspace is replaced in one transaction.
CREATE TABLE IF NOT EXISTS thread_sections (
  workspace_id TEXT NOT NULL,
  code_workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  thread_project_id TEXT REFERENCES thread_projects(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
  PRIMARY KEY (workspace_id, id),
  CHECK ((code_workspace_id IS NULL) <> (thread_project_id IS NULL)),
  CHECK (workspace_id = coalesce(code_workspace_id, 'thread:' || thread_project_id))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_sections_name ON thread_sections(workspace_id, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_thread_sections_code_workspace ON thread_sections(code_workspace_id);
CREATE INDEX IF NOT EXISTS idx_thread_sections_thread_project ON thread_sections(thread_project_id);

CREATE TABLE IF NOT EXISTS thread_section_assignments (
  conversation_id TEXT PRIMARY KEY REFERENCES conversation_threads(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  FOREIGN KEY (workspace_id, section_id) REFERENCES thread_sections(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_thread_section_assignments_section ON thread_section_assignments(workspace_id, section_id);

PRAGMA user_version = 85;
