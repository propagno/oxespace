/**
 * Nested conversations (B1.3): a conversation started by another one through
 * oxespace_thread_create, an Agent Work plan or a delegation keeps that link in
 * `conversation_threads.parent_thread_id` / `parent_via`. The columns are the
 * source of truth for `ConversationThread.parent`; data_json may carry a stale
 * copy and is overridden on read.
 */
import type { AppDatabase } from '../../db'
import { threadArchiveWithChildren } from '../../../../shared/threadConfirmations'
import { THREAD_PARENT_VIA, type ConversationThread, type ThreadChildrenSummary, type ThreadChildSummary, type ThreadCommandResult, type ThreadParentLink } from '../../../../shared/types/thread'
import type { CommandHost } from './kernel/command-router'

/** How deep `/archive confirm-with-children` follows children of children. */
export const ARCHIVE_CHILDREN_DEPTH = 5
const CHILDREN_LIMIT = 500

export interface ThreadParentColumns { parent_thread_id?: string | null; parent_via?: string | null }

/** Sets `thread.parent` from the row's columns, or removes a copy the columns no longer back. */
export function withParent(thread: ConversationThread, row: ThreadParentColumns): ConversationThread {
  if (row.parent_thread_id && (THREAD_PARENT_VIA as readonly string[]).includes(row.parent_via ?? '')) thread.parent = { threadId: row.parent_thread_id, via: row.parent_via as ThreadParentLink['via'] }
  else delete thread.parent
  return thread
}

/**
 * Inserts a new conversation row. A parent that does not exist (a deleted supervisor, say) or that is
 * the conversation itself is dropped, so the new conversation simply stands on its own.
 */
export function insertThreadRow(db: AppDatabase, thread: ConversationThread): void {
  const parent = thread.parent
  const valid = parent && parent.threadId !== thread.id && (THREAD_PARENT_VIA as readonly string[]).includes(parent.via)
    && db.prepare('SELECT 1 FROM conversation_threads WHERE id = ?').get(parent.threadId)
  if (!valid) delete thread.parent
  db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json, parent_thread_id, parent_via) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(thread.id, thread.workspaceId, thread.projectId, JSON.stringify(thread), '[]', valid ? parent!.threadId : null, valid ? parent!.via : null)
}

interface ChildRow { id: string; title: string | null; status: ConversationThread['status'] | null; via: ThreadParentLink['via']; archived: number | null; updated_at: number | null }

function childRows(db: AppDatabase, id: string): ThreadChildSummary[] {
  return (db.prepare(`SELECT id, json_extract(data_json, '$.title') AS title, json_extract(data_json, '$.status') AS status, parent_via AS via,
      json_extract(data_json, '$.archived') AS archived, json_extract(data_json, '$.updatedAt') AS updated_at
    FROM conversation_threads WHERE parent_thread_id = ? ORDER BY updated_at DESC, id LIMIT ?`).all(id, CHILDREN_LIMIT) as ChildRow[])
    .map(row => ({ id: row.id, title: row.title ?? '', status: row.status ?? 'idle', via: row.via, archived: !!row.archived, updatedAt: row.updated_at ?? 0 }))
}

/** Direct children and their combined state. Archived children are listed but not counted. */
export function threadChildren(db: AppDatabase, id: string): ThreadChildrenSummary {
  if (!db.prepare('SELECT 1 FROM conversation_threads WHERE id = ?').get(id)) throw Error('Thread not found')
  const children = childRows(db, id)
  const live = children.filter(child => !child.archived)
  const count = (status: ConversationThread['status']) => live.filter(child => child.status === status).length
  return { threadId: id, children, aggregate: { running: count('running'), approval: count('approval'), failed: count('failed'), done: count('idle') } }
}

/** Children still working: the persisted status, or a turn this process is running right now. */
function activeChildren(host: CommandHost, id: string): { active: number; total: number } {
  const live = childRows(host.db, id).filter(child => !child.archived)
  return { active: live.filter(child => child.status === 'running' || child.status === 'approval' || host.isBusy(child.id)).length, total: live.length }
}

async function stopTurn(host: CommandHost, id: string): Promise<void> {
  if (!host.isBusy(id)) return
  await host.interrupt(id)
  for (let attempt = 0; attempt < 50 && host.isBusy(id); attempt++) await new Promise(resolve => setTimeout(resolve, 100))
  if (host.isBusy(id)) throw Error('The active turn has not stopped. Try again after it finishes.')
}

async function archiveOne(host: CommandHost, id: string, summary: string): Promise<void> {
  await stopTurn(host, id)
  await host.disposeAdapter(id)
  const latest = host.read(id); latest.thread.archived = true; host.save(latest, { eventsFrom: latest.events.length })
  host.audit(id, { action: 'archive', actor: 'user', summary })
}

/** Archives the children of `id` (theirs first), down to ARCHIVE_CHILDREN_DEPTH levels; returns how many. */
async function archiveDescendants(host: CommandHost, id: string, depth: number, seen: Set<string>): Promise<number> {
  if (depth > ARCHIVE_CHILDREN_DEPTH) return 0
  let archived = 0
  for (const child of childRows(host.db, id)) {
    if (child.archived || seen.has(child.id)) continue
    seen.add(child.id)
    archived += await archiveDescendants(host, child.id, depth + 1, seen)
    await archiveOne(host, child.id, 'Archived with the conversation that started it')
    archived += 1
  }
  return archived
}

/**
 * `/archive` on a conversation whose children still work. Undefined leaves the ordinary archive flow
 * untouched: no active children, or an argument this step does not own.
 *  - `/archive` asks with threadArchiveWithChildren;
 *  - `/archive confirm` refuses with hasActiveChildren and the same confirmation, whose command a
 *    client that only knows `/archive confirm` runs as it is;
 *  - `/archive confirm-with-children` interrupts and archives the children, then the parent.
 */
export async function runNestedArchive(host: CommandHost, id: string, argument: string): Promise<ThreadCommandResult | undefined> {
  if (argument === 'confirm-with-children') {
    if (host.isConfiguring(id)) throw Error('Finish the active operation before running this command')
    const count = await archiveDescendants(host, id, 1, new Set([id]))
    await archiveOne(host, id, count ? `Archived with ${count} conversation${count === 1 ? '' : 's'} it started` : 'Archived')
    return { kind: 'navigate' }
  }
  if (argument && argument !== 'confirm') return undefined
  const children = activeChildren(host, id)
  if (!children.active) return undefined
  const confirm = threadArchiveWithChildren(children, host.read(id).thread.title)
  return argument === 'confirm' ? { kind: 'confirm', refusal: 'hasActiveChildren', confirm } : { kind: 'confirm', confirm }
}
