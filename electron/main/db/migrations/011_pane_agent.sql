ALTER TABLE panes ADD COLUMN agent_profile_id TEXT;
ALTER TABLE panes ADD COLUMN agent_name TEXT;

PRAGMA user_version = 11;
