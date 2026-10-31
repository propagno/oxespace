/**
 * The one authority check for the project's coordinator conversation (B1.4 · S7.5), shared by every gate: the tool
 * plan, role-kept actions, the delegation reconnect check, the pending summary and the flag served to the window.
 * A `project_coordinators` row grants the role only while all of these hold, read synchronously at each call:
 * - its conversation exists and is not archived;
 * - the conversation's project still has the root the identity was resolved from (`root_path`);
 * - the Team of that identity has no active coordinator member connected to another existing, unarchived conversation.
 * The last one is the Team's precedence: a write path that missed the invariant still cannot make two coordinators.
 * Kept free of heavier imports (only the incident sink), so the tool plan of a Code pane does not load the conversation history.
 */

import { recordIncident } from '../diagnostics/incident-sink'

const UNARCHIVED = (alias: string) => `COALESCE(json_extract(${alias}.data_json, '$.archived'), 0) = 0`

/** FROM/JOIN/WHERE over `project_coordinators pc`; append `AND …` to narrow it. */
export const EFFECTIVE_COORDINATORS = `FROM project_coordinators pc
  JOIN conversation_threads ct ON ct.id = pc.thread_id AND ${UNARCHIVED('ct')}
  JOIN thread_projects cp ON cp.id = ct.thread_project_id AND cp.root_path = pc.root_path
  WHERE NOT EXISTS (SELECT 1 FROM agent_teams team
    JOIN agent_team_members member ON member.team_id = team.id AND member.role = 'coordinator' AND member.archived = 0
    JOIN agent_team_execution_links link ON link.member_id = member.id AND link.owner_kind = 'thread' AND link.owner_id <> pc.thread_id
    JOIN conversation_threads other ON other.id = link.owner_id AND ${UNARCHIVED('other')}
    WHERE team.project_identity = pc.project_identity)`

/** The SQL that answers "does this conversation coordinate its project" for one `thread_id` parameter. */
export const IS_EFFECTIVE_COORDINATOR = `SELECT 1 ${EFFECTIVE_COORDINATORS} AND pc.thread_id = ? LIMIT 1`

/** An existing, unarchived conversation, as a SQL condition on `alias`. */
export const unarchived = UNARCHIVED

interface Database { prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown; run(...params: unknown[]): unknown } }

/** The conversations the authority check grants now. */
export function grantedCoordinators(db: Pick<Database, 'prepare'>): Set<string> {
  return new Set((db.prepare(`SELECT pc.thread_id AS id ${EFFECTIVE_COORDINATORS}`).all() as { id: string }[]).map(row => row.id))
}

/** Conversations in one set and not the other: whose coordinator flag changed. */
export function flagChanges(before: ReadonlySet<string>, after: ReadonlySet<string>): string[] {
  return [...[...before].filter(id => !after.has(id)), ...[...after].filter(id => !before.has(id))]
}

/**
 * ThreadProjectService.relink, inside its transaction: the project's rows follow the new root and identity. A row
 * whose new identity already has a coordinator is removed; the Team's precedence settles the rest on read.
 */
export function relinkProjectCoordinators(db: Database, projectId: string, identity: string, root: string, now = Date.now()): void {
  const rows = db.prepare(`SELECT pc.project_identity AS identity, pc.thread_id AS threadId FROM project_coordinators pc
    JOIN conversation_threads t ON t.id = pc.thread_id WHERE t.thread_project_id = ?`).all(projectId) as { identity: string; threadId: string }[]
  for (const row of rows) {
    const taken = row.identity !== identity && db.prepare('SELECT 1 FROM project_coordinators WHERE project_identity = ?').get(identity)
    if (taken) db.prepare('DELETE FROM project_coordinators WHERE thread_id = ?').run(row.threadId)
    else db.prepare('UPDATE project_coordinators SET project_identity = ?, root_path = ?, updated_at = ? WHERE thread_id = ?').run(identity, root, now, row.threadId)
  }
}

const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0')

/**
 * The `{ preview, expect }` a coordinator change takes over IPC (thread:set-coordinator, team:command); anything else
 * throws. With `confirm`, a call that is not a preview must hand back the preview's token (SECURITY L-4).
 */
export function coordinatorOptions(value: unknown, confirm = false): import('../../../../shared/types/thread').ProjectCoordinatorOptions {
  const parsed = parseOptions(value)
  if (confirm && !parsed.preview && !parsed.expect) throw Error('Invalid coordinator options: preview first, then confirm with its token')
  return parsed
}

/** A coordinator change notice that failed after the commit: recorded, never thrown (the authority check still holds on each call). */
export function coordinatorNoticeFailed(ids: readonly string[], error: unknown): void {
  console.warn('[coordinator] change notice failed for', ids.join(', '), error instanceof Error ? error.message : String(error))
  recordIncident('incident.ipc.handlerFailed', 'coordinator.changed')
}

function parseOptions(value: unknown): import('../../../../shared/types/thread').ProjectCoordinatorOptions {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid coordinator options')
  const { preview, expect } = value as { preview?: unknown; expect?: unknown }
  if (preview !== undefined && typeof preview !== 'boolean') throw Error('Invalid coordinator options')
  if (expect === undefined) return preview ? { preview } : {}
  const token = expect as { identity?: unknown; teamRevision?: unknown; coordinatorThreadId?: unknown } | null
  if (!token || typeof token !== 'object' || !text(token.identity, 4096)
    || !(token.teamRevision === null || Number.isSafeInteger(token.teamRevision))
    || !(token.coordinatorThreadId === null || text(token.coordinatorThreadId, 256))) throw Error('Invalid coordinator options')
  return { ...(preview ? { preview } : {}), expect: { identity: token.identity, teamRevision: token.teamRevision as number | null, coordinatorThreadId: token.coordinatorThreadId as string | null } }
}
