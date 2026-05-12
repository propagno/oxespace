ALTER TABLE agent_profiles ADD COLUMN system_prompt TEXT NULL;
ALTER TABLE agent_profiles ADD COLUMN parent_provider TEXT NULL;
PRAGMA user_version = 14;
