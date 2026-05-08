INSERT OR IGNORE INTO agent_profiles
  (agent_profile_id, name, provider, command, command_template, model, role, is_builtin, created_at)
VALUES
  ('builtin-agent-claude', 'Claude', 'claude', 'claude', '{{task}}', NULL, NULL, 1, strftime('%s', 'now') * 1000),
  ('builtin-agent-copilot', 'Copilot', 'copilot', 'copilot', '{{task}}', NULL, NULL, 1, strftime('%s', 'now') * 1000);

UPDATE agent_profiles
SET name = 'Claude', is_builtin = 1
WHERE agent_profile_id = 'builtin-agent-claude';

UPDATE agent_profiles
SET name = 'Copilot', is_builtin = 1
WHERE agent_profile_id = 'builtin-agent-copilot';

INSERT OR IGNORE INTO shell_profiles (id, name, executable, args_json, is_builtin)
VALUES
  ('builtin-claude', 'claude', 'claude', '[]', 1),
  ('builtin-copilot', 'copilot', 'copilot', '[]', 1);

UPDATE shell_profiles
SET
  name = 'claude',
  executable = COALESCE((SELECT command FROM agent_profiles WHERE agent_profile_id = 'builtin-agent-claude'), executable),
  args_json = '[]',
  is_builtin = 1
WHERE id = 'builtin-claude';

UPDATE shell_profiles
SET
  name = 'copilot',
  executable = COALESCE((SELECT command FROM agent_profiles WHERE agent_profile_id = 'builtin-agent-copilot'), executable),
  args_json = '[]',
  is_builtin = 1
WHERE id = 'builtin-copilot';

DELETE FROM agent_readiness_cache
WHERE provider NOT IN ('claude', 'copilot');

PRAGMA user_version = 5;
