-- Per-turn cost detail for the usage panel: which turn a row belongs to and how many
-- tool calls (steps) it made. Each step sends the conversation's context again, so a
-- long turn in a long conversation is where tokens go. Older rows keep NULL.
ALTER TABLE turn_usage ADD COLUMN turn_id TEXT;
ALTER TABLE turn_usage ADD COLUMN steps INTEGER;

PRAGMA user_version = 80;
