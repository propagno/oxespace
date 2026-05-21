INSERT OR IGNORE INTO shell_profiles (id, name, executable, args_json, is_builtin)
VALUES ('builtin-powershell', 'PowerShell', 'powershell.exe', '["-NoLogo"]', 1);

PRAGMA user_version = 31;
