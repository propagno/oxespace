ALTER TABLE workspaces ADD COLUMN theme_id TEXT NOT NULL DEFAULT 'midnight';
ALTER TABLE workspaces ADD COLUMN ui_density TEXT NOT NULL DEFAULT 'compact';
ALTER TABLE workspaces ADD COLUMN layout_preset INTEGER NOT NULL DEFAULT 4;

UPDATE workspaces
SET layout_preset = CASE layout
  WHEN '1x1' THEN 1
  WHEN '1x2' THEN 2
  WHEN '2x1' THEN 2
  WHEN '2x2' THEN 4
  WHEN '2x3' THEN 6
  WHEN '2x4' THEN 8
  WHEN '2x5' THEN 10
  WHEN '3x4' THEN 12
  WHEN '2x7' THEN 14
  WHEN '4x4' THEN 16
  ELSE 4
END;

PRAGMA user_version = 7;
