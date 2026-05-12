UPDATE shell_profiles
SET
  name = 'copilot shell',
  executable = 'powershell.exe',
  args_json = '["-NoLogo"]',
  is_builtin = 1,
  updated_at = datetime('now')
WHERE id = 'builtin-copilot';

PRAGMA user_version = 10;
