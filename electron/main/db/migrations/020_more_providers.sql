INSERT OR IGNORE INTO agent_profiles
  (agent_profile_id, name, provider, command, command_template, model, role, is_builtin, created_at)
VALUES
  ('builtin-agent-codex',  'Codex',  'codex',  'codex',        '{{task}}', NULL, NULL, 1, strftime('%s', 'now') * 1000),
  ('builtin-agent-antigravity', 'Antigravity', 'antigravity', 'agy',       '{{task}}', NULL, NULL, 1, strftime('%s', 'now') * 1000),
  ('builtin-agent-cursor', 'Cursor', 'cursor', 'cursor-agent', '{{task}}', NULL, NULL, 1, strftime('%s', 'now') * 1000);

UPDATE agent_profiles SET name = 'Codex',  is_builtin = 1 WHERE agent_profile_id = 'builtin-agent-codex';
UPDATE agent_profiles SET name = 'Antigravity', is_builtin = 1 WHERE agent_profile_id = 'builtin-agent-antigravity';
UPDATE agent_profiles SET name = 'Cursor', is_builtin = 1 WHERE agent_profile_id = 'builtin-agent-cursor';

INSERT OR IGNORE INTO shell_profiles (id, name, executable, args_json, is_builtin)
VALUES
  ('builtin-codex',  'codex',  'codex',        '[]', 1),
  ('builtin-antigravity', 'antigravity', 'agy',       '[]', 1),
  ('builtin-cursor', 'cursor', 'cursor-agent', '[]', 1);

DELETE FROM agent_readiness_cache
WHERE provider NOT IN ('claude', 'copilot', 'codex', 'antigravity', 'cursor');

PRAGMA user_version = 20;
