-- T54 · The permission mode a pane's Claude session started in, as its SessionStart hook reported it, so a resume
-- (B17 after a restart, or Restore session) starts it again in that mode and no other. Null: none recorded, which
-- resumes with no permission flag, as before. Only Claude Code's own four modes; anything else is never stored.
ALTER TABLE pane_agent_sessions ADD COLUMN permission_mode TEXT
  CHECK (permission_mode IS NULL OR permission_mode IN ('default', 'acceptEdits', 'plan', 'bypassPermissions'));

PRAGMA user_version = 91;
