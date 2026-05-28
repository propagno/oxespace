-- Onda 4: Background jobs leaves its top-of-workspace banner and becomes a
-- right-side dock panel like Editor/Review/GitHub. The per-workspace visibility,
-- expanded flag, and persisted width live alongside the other panel columns.
ALTER TABLE workspaces ADD COLUMN background_panel_visible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN background_panel_expanded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN background_panel_width_percent INTEGER NOT NULL DEFAULT 28;

PRAGMA user_version = 30;
