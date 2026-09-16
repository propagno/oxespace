import type { AppDatabase } from '../../db'
import type { DelegationTask, DelegationTarget } from '../../../../shared/types/delegation'
import type { CoordinationAction } from '../../../../shared/types/coordination'
import type { AgentExecution, ExecutionRegistry } from '../execution-registry'
import type { WorkspaceService } from '../workspace.service'
import { projectIdentity } from '../memory/memory-project.service'
import { CoordinationAuthorization } from './authorization'
import { registerLocalRepository } from './workspace-resolver'

const GRANT_TTL = 30 * 24 * 60 * 60 * 1000
export class TaskCoordinator {
  readonly authorization: CoordinationAuthorization
  constructor(private db: AppDatabase, private workspace: WorkspaceService, private executions: ExecutionRegistry) {
    this.authorization = new CoordinationAuthorization(db, executions)
  }
  async configureTarget(originWorkspace: string, path: string, enabled: boolean, allowEvidence: boolean): Promise<void> {
    if (typeof enabled !== 'boolean' || typeof allowEvidence !== 'boolean') throw new Error('Invalid consent')
    const origin = this.workspace.get(originWorkspace)
    if (!origin) throw new Error('Workspace not found')
    const originProject = await projectIdentity(origin.rootPath)
    if (!enabled) {
      // Revocation must work even when the target path no longer exists.
      const target = this.workspace.list().find(w => w.rootPath === path)
      if (!target) throw new Error('Target workspace not found')
      this.db.prepare('DELETE FROM coordination_routes WHERE origin_project=? AND target_workspace=?').run(originProject, target.id)
      return
    }
    const target = await registerLocalRepository(this.workspace, path)
    if (target.project === originProject) throw new Error('Same-project delegation does not require a cross-project route')
    this.db.prepare(`INSERT INTO coordination_routes VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(origin_project, target_workspace) DO UPDATE SET target_project=excluded.target_project,
      expires_at=excluded.expires_at, allow_evidence=excluded.allow_evidence`)
      .run(originProject, target.project, target.workspace.id, Date.now() + GRANT_TTL, Number(allowEvidence))
  }
  targets(project: string): DelegationTarget[] {
    return this.db.prepare(`SELECT w.id AS workspaceId, w.name, w.root_path AS rootPath,
      r.expires_at AS expiresAt, r.allow_evidence AS allowEvidence FROM coordination_routes r
      JOIN workspaces w ON w.id=r.target_workspace WHERE r.origin_project=? AND r.expires_at>?`)
      .all(project, Date.now()).map(row => ({ ...(row as DelegationTarget), allowEvidence: !!(row as DelegationTarget).allowEvidence }))
  }
  requireRoute(originProject: string, targetWorkspace: string, targetProject: string, evidence: boolean): void {
    if (originProject === targetProject) return
    const route = this.db.prepare(`SELECT allow_evidence AS evidence FROM coordination_routes
      WHERE origin_project=? AND target_workspace=? AND target_project=? AND expires_at>?`)
      .get(originProject, targetWorkspace, targetProject, Date.now()) as { evidence: number } | undefined
    if (!route || (evidence && !route.evidence)) throw new Error('CROSS_PROJECT_CONSENT_REQUIRED: authorize the destination and evidence in Workspace settings')
  }
  checkTask(task: DelegationTask): void {
    this.requireRoute(task.originProjectId ?? task.project, task.workspaceId, task.project, !!task.evidence?.length)
  }
  participant(task: DelegationTask, role: 'requester' | 'executor'): string {
    const existing = this.db.prepare('SELECT id FROM coordination_participants WHERE task_id=? AND role=?').get(task.id, role) as { id: string } | undefined
    return existing?.id ?? `${role}:${task.id}`
  }
  initialize(task: DelegationTask, consentRoles: readonly ('requester' | 'executor')[] = ['requester', 'executor']): void {
    this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO coordination_scopes VALUES (?, ?, ?, ?, ?, 1)').run(task.id,
        task.originWorkspaceId ?? task.workspaceId, task.originProjectId ?? task.project, task.workspaceId, task.project)
      for (const role of ['requester', 'executor'] as const) {
        const id = this.participant(task, role)
        this.db.prepare('INSERT OR IGNORE INTO coordination_participants VALUES (?, ?, ?, ?, ?)').run(id, task.id, role,
          role === 'requester' ? task.originWorkspaceId ?? task.workspaceId : task.workspaceId,
          role === 'requester' ? task.originProjectId ?? task.project : task.project)
        this.db.prepare('INSERT OR IGNORE INTO coordination_subscriptions(participant_id) VALUES (?)').run(id)
        for (const action of consentRoles.includes(role) ? ['read', 'message', role === 'requester' ? 'control' : 'report'] as CoordinationAction[] : []) {
          this.authorization.grantFromTrustedConsent(id, action, Date.now() + GRANT_TTL)
        }
      }
    })()
  }
  async bind(task: DelegationTask, role: 'requester' | 'executor', execution: AgentExecution): Promise<void> {
    this.checkTask(task)
    await this.authorization.bindFromTrustedConsent(this.participant(task, role), execution)
    this.checkTask(task)
  }
  async authorize(task: DelegationTask, execution: AgentExecution, action: CoordinationAction): Promise<void> {
    this.checkTask(task)
    const role = execution.id === task.originExecutionId ? 'requester' : 'executor'
    await this.authorization.authorize(this.participant(task, role), task.id, execution, action)
    this.checkTask(task)
  }
  receipt(taskId: string, stage: string): void {
    this.db.prepare('INSERT OR IGNORE INTO coordination_receipts VALUES (?, ?, ?)').run(taskId, stage, Date.now())
  }
  receipts(taskId: string) { return this.db.prepare('SELECT stage, created_at AS createdAt FROM coordination_receipts WHERE task_id=? ORDER BY created_at').all(taskId) }
  results(taskId: string) { return this.db.prepare('SELECT revision, text, created_at AS createdAt FROM coordination_results WHERE task_id=? ORDER BY revision DESC LIMIT 20').all(taskId) }
  cursor(task: DelegationTask, role: 'requester' | 'executor'): number {
    return (this.db.prepare('SELECT cursor FROM coordination_subscriptions WHERE participant_id=?').get(this.participant(task, role)) as { cursor: number } | undefined)?.cursor ?? 0
  }
  result(taskId: string, text: string): void {
    this.db.prepare(`INSERT INTO coordination_results SELECT ?, COALESCE(MAX(revision), 0)+1, ?, ? FROM coordination_results WHERE task_id=?`)
      .run(taskId, text, Date.now(), taskId)
  }
  acknowledge(task: DelegationTask, execution: AgentExecution, cursor: number): void {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid cursor')
    const max = this.db.prepare('SELECT COALESCE(MAX(cursor),0) AS cursor FROM delegation_events WHERE task_id=?').get(task.id) as { cursor: number }
    if (cursor > max.cursor) throw new Error('Cursor exceeds task events')
    this.db.prepare('UPDATE coordination_subscriptions SET cursor=MAX(cursor, ?) WHERE participant_id=?')
      .run(cursor, this.participant(task, execution.id === task.originExecutionId ? 'requester' : 'executor'))
  }
}
