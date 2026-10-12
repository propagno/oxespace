import type { AppDatabase } from '../../db'
import type {
  DelegationCheckout,
  DelegationNativeSession,
  DelegationTask,
  KnowledgeTransferBundle
} from '../../../../shared/types/delegation'

export interface DelegationPage {
  tasks: DelegationTask[]
  nextCursor: string | null
}

export class DelegationRepository {
  constructor(private readonly db: AppDatabase) {}

  get(id: string): DelegationTask | undefined {
    const row = this.db.prepare('SELECT payload FROM delegations WHERE id = ?').get(id) as { payload: string } | undefined
    return row ? this.decode(row.payload) : undefined
  }

  all(): DelegationTask[] {
    return (this.db.prepare('SELECT payload FROM delegations').all() as Array<{ payload: string }>).map(row => this.decode(row.payload))
  }

  byWorkspace(workspaceId: string, limit = 100, cursor?: string): DelegationPage {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid delegation page size')
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)))
    const decoded = cursor ? decodeCursor(cursor) : null
    const rows = (decoded ? this.db.prepare(`
      SELECT d.payload, i.updated_at AS updatedAt
      FROM delegation_task_index i
      JOIN delegations d ON d.id = i.task_id
      WHERE (i.workspace_id = ? OR i.origin_workspace_id = ?)
        AND (i.updated_at < ? OR (i.updated_at = ? AND i.task_id < ?))
      ORDER BY i.updated_at DESC, i.task_id DESC
      LIMIT ?
    `).all(workspaceId, workspaceId, decoded.updatedAt, decoded.updatedAt, decoded.id, safeLimit + 1) : this.db.prepare(`
      SELECT d.payload, i.updated_at AS updatedAt
      FROM delegation_task_index i
      JOIN delegations d ON d.id = i.task_id
      WHERE (i.workspace_id = ? OR i.origin_workspace_id = ?)
      ORDER BY i.updated_at DESC, i.task_id DESC
      LIMIT ?
    `).all(workspaceId, workspaceId, safeLimit + 1)) as Array<{ payload: string; updatedAt: number }>
    const page = rows.slice(0, safeLimit)
    const tail = page.at(-1)
    return {
      tasks: page.map(row => this.decode(row.payload)),
      nextCursor: rows.length > safeLimit && tail ? encodeCursor(tail.updatedAt, this.decode(tail.payload).id) : null
    }
  }

  activeCount(project?: string): number {
    const states = "'preparing','starting','accepted','blocked'"
    const row = project
      ? this.db.prepare(`SELECT COUNT(*) AS count FROM delegation_task_index WHERE project = ? AND state IN (${states})`).get(project)
      : this.db.prepare(`SELECT COUNT(*) AS count FROM delegation_task_index WHERE state IN (${states})`).get()
    return (row as { count: number }).count
  }

  forExecution(executionId: string): DelegationTask[] {
    return (this.db.prepare(`
      SELECT payload FROM delegations
      WHERE origin_execution = ? OR json_extract(payload, '$.destinationExecutionId') = ?
    `).all(executionId, executionId) as Array<{ payload: string }>).map(row => this.decode(row.payload))
  }

  forPane(paneId: string): DelegationTask | undefined {
    const row = this.db.prepare("SELECT payload FROM delegations WHERE json_extract(payload, '$.paneId') = ? LIMIT 1")
      .get(paneId) as { payload: string } | undefined
    return row ? this.decode(row.payload) : undefined
  }

  save(task: DelegationTask): void {
    this.db.transaction(() => this.saveAtomic(task))()
  }

  private saveAtomic(task: DelegationTask): void {
    task.updatedAt = Date.now()
    this.db.prepare(`
      INSERT INTO delegations(id, origin_execution, request_key, workspace_id, payload)
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        origin_execution = excluded.origin_execution,
        request_key = excluded.request_key,
        workspace_id = excluded.workspace_id
    `).run(task.id, task.originExecutionId, task.key, task.workspaceId, JSON.stringify(task))
    if (task.checkout) this.saveCheckout(task.id, task.branchIntent ?? { strategy: task.checkout.strategy }, task.checkout)
    if (task.nativeSession) this.saveSession(task.id, task.nativeSession)
    else this.db.prepare('DELETE FROM delegation_session_bindings WHERE task_id = ?').run(task.id)
    if (task.knowledgeBundle) this.saveBundle(task.id, task.knowledgeBundle)
  }

  saveCheckout(taskId: string, requested: unknown, checkout: DelegationCheckout): void {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO delegation_checkouts(task_id, schema_version, strategy, requested_json, resolved_json, created_at, updated_at)
      VALUES(?, 1, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        strategy = excluded.strategy,
        requested_json = excluded.requested_json,
        resolved_json = excluded.resolved_json,
        updated_at = excluded.updated_at
    `).run(taskId, checkout.strategy, JSON.stringify(requested), JSON.stringify(checkout), now, now)
  }

  saveSession(taskId: string, session: DelegationNativeSession): void {
    this.db.prepare(`
      INSERT INTO delegation_session_bindings(
        task_id, provider, native_session_id, canonical_root, generation, resumable, observed_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET
        provider = excluded.provider,
        native_session_id = excluded.native_session_id,
        canonical_root = excluded.canonical_root,
        generation = excluded.generation,
        resumable = excluded.resumable,
        observed_at = excluded.observed_at,
        updated_at = excluded.updated_at
    `).run(taskId, session.provider, session.nativeSessionId, session.canonicalRoot, session.generation,
      Number(session.resumable), session.observedAt, Date.now())
  }

  saveBundle(taskId: string, bundle: KnowledgeTransferBundle): void {
    const existing = this.db.prepare('SELECT bundle_sha256 FROM delegation_handoff_revisions WHERE task_id = ? AND revision = ?').get(taskId, bundle.revision) as { bundle_sha256: string } | undefined
    if (existing && existing.bundle_sha256 !== bundle.sha256) throw new Error('HANDOFF_REVISION_IMMUTABLE')
    this.db.prepare(`
      INSERT OR IGNORE INTO delegation_handoff_revisions(task_id, revision, bundle_json, bundle_sha256, created_at)
      VALUES(?, ?, ?, ?, ?)
    `).run(taskId, bundle.revision, JSON.stringify(bundle), bundle.sha256, bundle.createdAt)
  }

  journal(taskId: string, operation: string, generation: number, state: 'requested' | 'running' | 'succeeded' | 'failed' | 'unknown', receipt?: unknown, error?: string): void {
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO delegation_operation_journal(
        task_id, operation, generation, state, receipt_json, error, started_at, finished_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id, operation, generation) DO UPDATE SET
        state = excluded.state,
        receipt_json = excluded.receipt_json,
        error = excluded.error,
        finished_at = excluded.finished_at
    `).run(taskId, operation, generation, state, receipt === undefined ? null : JSON.stringify(receipt), error ?? null,
      now, ['succeeded', 'failed', 'unknown'].includes(state) ? now : null)
  }

  operationSucceeded(taskId: string, operation: string, generation: number): boolean {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM delegation_operation_journal
      WHERE task_id = ? AND operation = ? AND generation = ? AND state = 'succeeded'
    `).get(taskId, operation, generation))
  }

  settleRunningUnknown(reason: string): number {
    return this.db.prepare(`
      UPDATE delegation_operation_journal
      SET state = 'unknown', error = ?, finished_at = ?
      WHERE state IN ('requested', 'running')
    `).run(reason, Date.now()).changes
  }

  private decode(payload: string): DelegationTask {
    const task = JSON.parse(payload) as DelegationTask
    task.schemaVersion ??= undefined
    task.surface ??= 'terminal'
    task.branchIntent ??= { strategy: 'generated' }
    task.recoveryActions = recoveryActions(task)
    return task
  }
}

function encodeCursor(updatedAt: number, id: string): string {
  return Buffer.from(JSON.stringify([updatedAt, id])).toString('base64url')
}

function decodeCursor(cursor: string): { updatedAt: number; id: string } {
  if (cursor.length > 256) throw new Error('Invalid delegation cursor')
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(value) || value.length !== 2 || !Number.isSafeInteger(value[0]) || typeof value[1] !== 'string' || !value[1]) throw new Error()
    return { updatedAt: value[0], id: value[1] }
  } catch { throw new Error('Invalid delegation cursor') }
}

function recoveryActions(task: DelegationTask): DelegationTask['recoveryActions'] {
  if (task.state === 'review') return ['open', 'approve', 'cancel']
  if (task.state === 'failed' || task.state === 'interrupted') {
    return task.nativeSession?.resumable ? ['open', 'resume', 'new-session', 'cancel'] : task.destinationThreadId ? ['open', 'new-session', 'cancel'] : ['open', 'retry', 'cancel']
  }
  if (['starting', 'accepted', 'blocked'].includes(task.state)) return ['open', 'continue', 'cancel']
  return ['open']
}
