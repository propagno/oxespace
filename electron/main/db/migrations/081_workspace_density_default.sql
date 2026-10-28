-- Density became an app-wide preference (Settings > Appearance). A workspace now overrides it
-- only when the person picked a density for it; 'default' follows the app. Compact was the
-- implicit default every workspace got, and it matches the app default, so it becomes 'default'.
UPDATE workspaces SET ui_density = 'default' WHERE ui_density = 'compact';

PRAGMA user_version = 81;
