import type { AppDatabase } from '../../db'

/** File checkpoints (undo for a turn's files) older than this are dropped, beyond the newest ones of each conversation. */
export const CHECKPOINT_MAX_AGE_DAYS = 30
/** Each conversation keeps undo for at least its newest turns, whatever their age. */
export const CHECKPOINTS_KEPT_PER_THREAD = 20
/** Settled entries of the operation journal (sent, acknowledged, finished) older than this are dropped. */
export const OPERATION_MAX_AGE_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

export interface RetentionResult { checkpoints: number; operations: number }

/**
 * What OXESpace keeps of a conversation besides the conversation itself. Messages, tool results and costs are never
 * pruned; file checkpoints (which can hold megabytes of file contents per turn) and the settled operation journal are.
 * Open checkpoints and unsettled operations are left alone: they describe work that may still need recovery.
 */
export function pruneThreadData(db: AppDatabase, now = Date.now()): RetentionResult {
  const checkpointCutoff = now - CHECKPOINT_MAX_AGE_DAYS * DAY_MS
  const operationCutoff = now - OPERATION_MAX_AGE_DAYS * DAY_MS
  const result = db.transaction(() => {
    const checkpoints = db.prepare(`DELETE FROM conversation_checkpoints
      WHERE state != 'open' AND created_at < ?
        AND id NOT IN (SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY created_at DESC) AS position FROM conversation_checkpoints
        ) WHERE position <= ?)`).run(checkpointCutoff, CHECKPOINTS_KEPT_PER_THREAD).changes
    const operations = db.prepare(`DELETE FROM conversation_operations
      WHERE state IN ('completed', 'failed', 'cancelled') AND updated_at < ?`).run(operationCutoff).changes
    return { checkpoints, operations }
  })()
  // Give the space back to the file system's view of the WAL and refresh the planner's statistics.
  // Neither blocks for long, unlike a full VACUUM.
  try { db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* Another connection may hold the WAL; next start retries. */ }
  try { db.pragma('optimize') } catch { /* Statistics refresh is optional. */ }
  return result
}
