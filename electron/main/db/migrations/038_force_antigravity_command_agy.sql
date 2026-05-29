-- Force command and executable to agy for the antigravity profiles
UPDATE agent_profiles SET command = 'agy' WHERE agent_profile_id = 'builtin-agent-antigravity';
UPDATE shell_profiles SET executable = 'agy' WHERE id = 'builtin-antigravity';

PRAGMA user_version = 38;
