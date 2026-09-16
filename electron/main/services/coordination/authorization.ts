import type { AppDatabase } from '../../db'
import type { CoordinationAction, CoordinationParticipant, CoordinationRole } from '../../../../shared/types/coordination'
import { ExecutionRegistry, type AgentExecution } from '../execution-registry'
import { projectIdentity } from '../memory/memory-project.service'

const allowed: Record<CoordinationRole, readonly CoordinationAction[]> = {
  requester: ['read', 'message', 'control'], executor: ['read', 'message', 'report'], observer: ['read']
}

/** Internal policy primitive, not an IPC/MCP handler. Grant/bind require trusted UI
 * consent or an already-authorized coordinator. Never expose them to tool input.
 * Bindings intentionally vanish on restart; native conversation IDs confer no access. */
export class CoordinationAuthorization {
  private bindings = new Map<string, string>()
  constructor(private readonly db: AppDatabase, private readonly executions: ExecutionRegistry,
    private readonly identify: (cwd: string) => Promise<string> = projectIdentity,
    private readonly now: () => number = Date.now) {}

  private participant(id: string): CoordinationParticipant {
    const value = this.db.prepare(`SELECT id, task_id AS taskId, role,
      workspace_id AS workspaceId, project_id AS projectId FROM coordination_participants WHERE id = ?`)
      .get(id) as CoordinationParticipant | undefined
    if (!value) throw new Error('COORDINATION_ACCESS_DENIED')
    return value
  }

  grantFromTrustedConsent(id: string, action: CoordinationAction, expiresAt: number): void {
    const member = this.participant(id)
    if (!allowed[member.role]?.includes(action) || !Number.isSafeInteger(expiresAt) || expiresAt <= this.now()) {
      throw new Error('Invalid coordination grant')
    }
    this.db.prepare(`INSERT INTO coordination_grants(participant_id, action, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(participant_id, action) DO UPDATE SET expires_at=excluded.expires_at, revoked_at=NULL`)
      .run(id, action, expiresAt)
  }

  revoke(id: string): void {
    this.db.prepare('UPDATE coordination_grants SET revoked_at=? WHERE participant_id=?').run(this.now(), id)
    this.bindings.delete(id)
  }

  private async verifyExecution(member: CoordinationParticipant, execution: AgentExecution): Promise<void> {
    const registered = this.executions.authenticate(execution.id, execution.token, execution.workspaceId)
    const project = await this.identify(registered.cwd)
    // Identity lookup is async: a terminal may have ended while Git was running.
    this.executions.authenticate(execution.id, execution.token, execution.workspaceId)
    if (member.workspaceId !== registered.workspaceId || member.projectId !== project) {
      throw new Error('COORDINATION_ACCESS_DENIED')
    }
  }

  async bindFromTrustedConsent(id: string, execution: AgentExecution): Promise<void> {
    const member = this.participant(id)
    await this.verifyExecution(member, execution)
    this.requireGrant(member, 'read')
    this.bindings.set(id, execution.id)
  }

  private requireGrant(member: CoordinationParticipant, action: CoordinationAction): void {
    if (!allowed[member.role]?.includes(action) || !this.db.prepare(`SELECT 1 FROM coordination_grants
      WHERE participant_id=? AND action=? AND revoked_at IS NULL AND expires_at>?`)
      .get(member.id, action, this.now())) throw new Error('COORDINATION_ACCESS_DENIED')
  }

  async authorize(id: string, taskId: string, execution: AgentExecution, action: CoordinationAction): Promise<void> {
    const member = this.participant(id)
    await this.verifyExecution(member, execution)
    if (member.taskId !== taskId || this.bindings.get(id) !== execution.id) throw new Error('COORDINATION_ACCESS_DENIED')
    this.requireGrant(member, action)
  }
}
