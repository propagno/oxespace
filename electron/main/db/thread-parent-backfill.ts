import type { Database } from 'better-sqlite3'

type Via = 'thread_create' | 'work' | 'delegation'
interface Candidate { child: string; parent: string; via: Via; at: number }
export interface ThreadParentBackfill { linked: number; skipped: { child: string; parent: string; via: Via; reason: 'self' | 'cycle' }[] }

/**
 * One-time step of migration 086: sets `parent_thread_id` from the links that already record who
 * started a conversation — `mcp_thread_handoffs` (oxespace_thread_create), `work_tasks` joined to
 * `work_runs.supervisor_thread_id` (Agent Work) and a delegation's `destinationThreadId` whose
 * origin was a Thread (`originPaneId` = `thread:<id>`).
 *
 * A child with several candidate parents takes the EARLIEST link (by the time each source recorded
 * it): that is the conversation that actually started it, and later links only reused it. A link
 * that would make a conversation its own ancestor (A→A, or any chain that loops) is skipped and
 * reported; the next-earliest candidate of that child is then tried. Children that already have a
 * parent keep it, so a replay changes nothing.
 */
export function backfillThreadParents(db: Database): ThreadParentBackfill {
  const exists = new Set((db.prepare('SELECT id FROM conversation_threads').all() as { id: string }[]).map(row => row.id))
  const parents = new Map<string, string>()
  for (const row of db.prepare('SELECT id, parent_thread_id AS parent FROM conversation_threads WHERE parent_thread_id IS NOT NULL').all() as { id: string; parent: string }[]) parents.set(row.id, row.parent)
  const candidates = [
    ...db.prepare("SELECT destination_thread_id AS child, origin_thread_id AS parent, 'thread_create' AS via, created_at AS at FROM mcp_thread_handoffs").all(),
    ...db.prepare(`SELECT t.thread_id AS child, r.supervisor_thread_id AS parent, 'work' AS via, COALESCE(t.started_at, r.created_at) AS at
      FROM work_tasks t JOIN work_runs r ON r.id = t.run_id WHERE t.thread_id IS NOT NULL`).all(),
    ...db.prepare(`SELECT json_extract(payload, '$.destinationThreadId') AS child, substr(json_extract(payload, '$.originPaneId'), 8) AS parent,
      'delegation' AS via, COALESCE(json_extract(payload, '$.createdAt'), 0) AS at FROM delegations
      WHERE json_extract(payload, '$.destinationThreadId') IS NOT NULL AND json_extract(payload, '$.originPaneId') LIKE 'thread:%'`).all()
  ] as Candidate[]
  // Stable: equal times keep the source order above.
  candidates.sort((a, b) => Number(a.at) - Number(b.at))
  const result: ThreadParentBackfill = { linked: 0, skipped: [] }
  const update = db.prepare('UPDATE conversation_threads SET parent_thread_id = ?, parent_via = ? WHERE id = ? AND parent_thread_id IS NULL')
  for (const candidate of candidates) {
    const { child, parent, via } = candidate
    if (typeof child !== 'string' || typeof parent !== 'string' || !exists.has(child) || !exists.has(parent) || parents.has(child)) continue
    if (child === parent) { result.skipped.push({ child, parent, via, reason: 'self' }); continue }
    if (isAncestor(parents, child, parent)) { result.skipped.push({ child, parent, via, reason: 'cycle' }); continue }
    parents.set(child, parent)
    update.run(parent, via, child)
    result.linked += 1
  }
  // A count only: never an id, a title or a message. The skipped links are returned to the caller.
  if (result.skipped.length) console.warn(`[db] thread parent backfill skipped ${result.skipped.length} link(s) that would form a cycle`)
  return result
}

/** Whether `candidate` is `from` or one of its ancestors, walking at most one step per known link. */
function isAncestor(parents: Map<string, string>, candidate: string, from: string): boolean {
  let current: string | undefined = from
  for (let steps = 0; current !== undefined && steps <= parents.size; steps += 1) {
    if (current === candidate) return true
    current = parents.get(current)
  }
  return false
}
