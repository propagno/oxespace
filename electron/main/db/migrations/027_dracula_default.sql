-- Dracula becomes the default theme for OXESpace. Only fills rows that never
-- had a theme set (NULL/empty); workspaces with any explicit theme — including
-- 'midnight' — stay untouched because we can't distinguish "user picked
-- midnight" from "user accepted previous default of midnight" after the fact.
UPDATE workspaces
SET theme_id = 'dracula',
    updated_at = datetime('now')
WHERE theme_id IS NULL OR theme_id = '';

PRAGMA user_version = 27;
