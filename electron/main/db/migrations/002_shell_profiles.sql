INSERT OR IGNORE INTO shell_profiles (id, name, executable, args_json, is_builtin)
VALUES
  ('builtin-claude', 'claude', 'claude', '[]', 1),
  ('builtin-copilot', 'copilot shell', 'powershell.exe', '["-NoLogo"]', 1);

UPDATE workspaces
SET default_shell_profile_id = 'builtin-claude'
WHERE default_shell_profile_id IN ('builtin-powershell', 'builtin-cmd', 'builtin-bash', 'builtin-wsl');

UPDATE panes
SET shell_profile_id = 'builtin-claude'
WHERE shell_profile_id IN ('builtin-powershell', 'builtin-cmd', 'builtin-bash', 'builtin-wsl');

DELETE FROM shell_profiles
WHERE id IN ('builtin-powershell', 'builtin-cmd', 'builtin-bash', 'builtin-wsl');

PRAGMA user_version = 2;
