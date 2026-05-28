-- Keep Background jobs compact by default. Preserve any workspace the user
-- already resized away from the old 36% default or expanded explicitly.
UPDATE workspaces
   SET background_panel_width_percent = 28
 WHERE background_panel_width_percent = 36
   AND background_panel_expanded = 0;

PRAGMA user_version = 36;
