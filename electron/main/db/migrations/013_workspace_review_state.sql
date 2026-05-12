ALTER TABLE workspaces ADD COLUMN review_panel_visible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN review_panel_expanded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN review_panel_width_percent INTEGER NOT NULL DEFAULT 36;
PRAGMA user_version = 13;
