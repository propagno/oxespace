-- POSIX hosts: the neutral built-in shell is bash, not PowerShell.
--
-- Seeded as a NEW row (builtin-bash) with every reference repointed. The
-- builtin-powershell row is deliberately KEPT rather than deleted: it holds the
-- foreign keys valid, and a database carried back to Windows can be repaired
-- with a single UPDATE instead of being left inconsistent.
-- Values must stay in lockstep with services/shell-profile.defaults.ts.
INSERT OR IGNORE INTO shell_profiles (id, name, executable, args_json, is_builtin)
VALUES ('builtin-bash', 'Bash', '/bin/bash', '["-l"]', 1);

-- The copilot profile wraps a shell (see migrations 005/010), so on POSIX that
-- wrapper has to be bash. Its `-NoLogo` argument is PowerShell-only and would
-- make bash exit immediately, so the args are reset alongside the executable.
UPDATE shell_profiles
SET executable = '/bin/bash', args_json = '[]'
WHERE id = 'builtin-copilot' AND executable = 'powershell.exe';

UPDATE workspaces
SET default_shell_profile_id = 'builtin-bash'
WHERE default_shell_profile_id = 'builtin-powershell';

UPDATE panes
SET shell_profile_id = 'builtin-bash'
WHERE shell_profile_id = 'builtin-powershell';

PRAGMA user_version = 46;
