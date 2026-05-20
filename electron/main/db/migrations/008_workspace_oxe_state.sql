ALTER TABLE workspaces ADD COLUMN oxe_panel_visible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN oxe_panel_expanded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN oxe_panel_width_percent INTEGER NOT NULL DEFAULT 40;

PRAGMA user_version = 8;
