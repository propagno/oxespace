INSERT OR IGNORE INTO agent_profiles
  (agent_profile_id, name, provider, command, command_template, model, role, is_builtin, created_at)
VALUES
  ('builtin-agent-grok', 'Grok CLI', 'grok', 'grok', '{{task}}', NULL, NULL, 1, strftime('%s', 'now') * 1000);

INSERT OR IGNORE INTO shell_profiles (id, name, executable, args_json, is_builtin)
VALUES ('builtin-grok', 'grok', 'grok', '[]', 1);

PRAGMA user_version = 41;
