-- Project identity survives workspace/worktree removal. Knowledge lives in the provider.
CREATE TABLE IF NOT EXISTS memory_projects (
  id TEXT PRIMARY KEY,
  identity TEXT NOT NULL UNIQUE,
  settings_json TEXT NOT NULL DEFAULT '{"enabled":false,"automaticCapture":false,"automaticContext":false}'
);
CREATE TABLE IF NOT EXISTS memory_runtime (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  settings_json TEXT NOT NULL
);
PRAGMA user_version = 47;
