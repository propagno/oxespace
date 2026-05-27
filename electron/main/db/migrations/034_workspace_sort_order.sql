-- Adds a manual ordering column so workspaces can be drag-reordered in the
-- sidebar. Defaults to NULL; the migration also seeds existing rows so the
-- on-screen order remains stable: each existing workspace gets a sort_order
-- equal to its position when sorted by created_at (the previous order).
ALTER TABLE workspaces ADD COLUMN sort_order INTEGER;

UPDATE workspaces
SET sort_order = (
  SELECT count(*)
  FROM workspaces AS w2
  WHERE w2.created_at < workspaces.created_at
);

PRAGMA user_version = 34;
