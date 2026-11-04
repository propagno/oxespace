-- 1.5.0 A8 · Workspace color: one of eight palette slots (1–8) the person picks for a workspace. NULL means
-- "not chosen": the renderer then shows a stable color derived from the workspace id (shared/workspace-color.ts).
-- Existing rows keep NULL; nothing is backfilled and theme_id is untouched.
ALTER TABLE workspaces ADD COLUMN color INTEGER NULL CHECK (color IS NULL OR color BETWEEN 1 AND 8);

PRAGMA user_version = 93;
