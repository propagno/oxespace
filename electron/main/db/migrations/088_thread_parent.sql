-- Nested conversations (B1.3): the conversation that started this one, through
-- oxespace_thread_create, an Agent Work plan or a delegation. Deleting the parent
-- leaves the child standing on its own. The backfill from the existing links
-- (mcp_thread_handoffs, work_tasks, delegations) runs right after this script,
-- in the same transaction, and never creates a cycle.
ALTER TABLE conversation_threads ADD COLUMN parent_thread_id TEXT REFERENCES conversation_threads(id) ON DELETE SET NULL;
ALTER TABLE conversation_threads ADD COLUMN parent_via TEXT CHECK(parent_via IN ('thread_create', 'work', 'delegation'));
CREATE INDEX IF NOT EXISTS idx_conversation_threads_parent ON conversation_threads(parent_thread_id);

PRAGMA user_version = 88;
