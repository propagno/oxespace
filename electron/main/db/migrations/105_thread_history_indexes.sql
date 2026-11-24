-- OXE-351 (b): indexes on the JSON fields ThreadHistory filters and sorts by. Each expression is written exactly as
-- the queries in thread-history.ts write it, so SQLite can use the index for them.
--   conversation_events_type: a conversation's events of one type (tool, subagent, request), in seq order.
--   conversation_turns_sequence: a conversation's turns in their sequence order, without a sort of their own.
--   conversation_turns_operation: the turn that confirms an operation (reconcileOperation).
--   conversation_threads_status: the conversations waiting for approval, without reading every conversation.
CREATE INDEX IF NOT EXISTS conversation_events_type ON conversation_events(thread_id, json_extract(data_json, '$.type'), seq);
CREATE INDEX IF NOT EXISTS conversation_turns_sequence ON conversation_turns(thread_id, json_extract(data_json, '$.sequence'));
CREATE INDEX IF NOT EXISTS conversation_turns_operation ON conversation_turns(thread_id, json_extract(data_json, '$.operationId'));
CREATE INDEX IF NOT EXISTS conversation_threads_status ON conversation_threads(json_extract(data_json, '$.status'));

PRAGMA user_version = 105;
