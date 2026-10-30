-- What OXESpace knows about each project memory note it wrote (roadmap M3, M5, M7): where it came
-- from, whether it is trusted, who may see it, and what the person decided about it. The note itself
-- lives in AI Memory; this table is the app's own record, so a note can be shown, edited, hidden or
-- exported even when that service is stopped. Rows go with the project.
CREATE TABLE IF NOT EXISTS memory_notes (
  project_id TEXT NOT NULL REFERENCES memory_projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  title TEXT,
  text TEXT NOT NULL,
  kind TEXT,
  scope TEXT NOT NULL DEFAULT 'project' CHECK(scope IN ('personal', 'project', 'team')),
  trust TEXT NOT NULL DEFAULT 'untrusted' CHECK(trust IN ('trusted', 'untrusted')),
  suspicious INTEGER NOT NULL DEFAULT 0,
  origin_kind TEXT NOT NULL DEFAULT 'unknown' CHECK(origin_kind IN ('user', 'agent', 'file', 'web', 'tool', 'unknown')),
  origin_agent TEXT,
  origin_session TEXT,
  origin_thread TEXT,
  origin_excerpt TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  wrong INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  deleted_at INTEGER,
  superseded_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, path)
);

-- Which agents were given a note, and how often: one row per agent and note.
CREATE TABLE IF NOT EXISTS memory_note_uses (
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 1,
  first_used_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  last_session TEXT,
  PRIMARY KEY (project_id, path, agent_id),
  FOREIGN KEY (project_id, path) REFERENCES memory_notes(project_id, path) ON DELETE CASCADE
);

PRAGMA user_version = 82;
