ALTER TABLE workspaces ADD COLUMN editor_visible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN editor_expanded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN editor_width_percent INTEGER NOT NULL DEFAULT 40;

PRAGMA user_version = 6;
