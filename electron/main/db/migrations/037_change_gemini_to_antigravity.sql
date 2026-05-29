-- Remove old gemini profile and agent
DELETE FROM agent_profiles WHERE agent_profile_id = 'builtin-agent-gemini';
DELETE FROM shell_profiles WHERE id = 'builtin-gemini';

-- Insert new antigravity agent and shell profile
INSERT OR IGNORE INTO agent_profiles
  (agent_profile_id, name, provider, command, command_template, model, role, is_builtin, created_at)
VALUES
  ('builtin-agent-antigravity', 'Antigravity', 'antigravity', 'agy', '{{task}}', NULL, NULL, 1, strftime('%s', 'now') * 1000);

INSERT OR IGNORE INTO shell_profiles (id, name, executable, args_json, is_builtin)
VALUES
  ('builtin-antigravity', 'antigravity', 'agy', '[]', 1);

-- Force command and executable to agy if they already existed
UPDATE agent_profiles SET command = 'agy' WHERE agent_profile_id = 'builtin-agent-antigravity';
UPDATE shell_profiles SET executable = 'agy' WHERE id = 'builtin-antigravity';

-- Update panes that might be referencing gemini
UPDATE panes SET agent_profile_id = 'builtin-agent-antigravity' WHERE agent_profile_id = 'builtin-agent-gemini';
UPDATE panes SET agent_name = 'Antigravity' WHERE agent_name = 'Gemini';
UPDATE panes SET shell_profile_id = 'builtin-antigravity' WHERE shell_profile_id = 'builtin-gemini';

-- Update readiness cache
DELETE FROM agent_readiness_cache WHERE provider = 'gemini';

PRAGMA user_version = 37;
