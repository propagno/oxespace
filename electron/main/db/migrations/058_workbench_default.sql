-- Adopt the new Workbench palette once for workspaces created before this
-- release. A later theme choice is stored normally and is not reset on boot.
UPDATE workspaces SET theme_id = 'midnight' WHERE theme_id <> 'midnight';

PRAGMA user_version = 58;
