-- Worktrees graduates from a per-pane modal into a workspace-scoped right
-- dock panel (parity with Editor / Review / GitHub / Background). The three
-- columns mirror the other panels' shape: visibility, expanded flag, width.
ALTER TABLE workspaces ADD COLUMN worktree_panel_visible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN worktree_panel_expanded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN worktree_panel_width_percent INTEGER NOT NULL DEFAULT 36;

PRAGMA user_version = 33;
