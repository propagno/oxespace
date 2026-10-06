import type { AppDatabase } from '../../db'
import type { AgentExecution, ExecutionOwner, ExecutionRegistry } from '../execution-registry'
import { projectIdentity } from '../memory/memory-project.service'
import { TeamRepository } from './team-repository'

/** A saved surface is a navigation hint, not an authorization credential.
 * Trusted UI must connect a live execution; restart invalidates that consent binding.
 * Membership/role are re-read on every tool call, including after identity lookup. */
export class TeamAccess {
  private readonly connected = new Map<string, string>()
  private readonly delivery = new Set<string>()
  readonly repository: TeamRepository
  constructor(private readonly db: AppDatabase, private readonly executions: ExecutionRegistry,
    private readonly identify = projectIdentity) { this.repository = new TeamRepository(db) }
  snapshotFromUi(teamId: string) {
    const team = this.repository.get(teamId)
    return { ...team, members: team.members.map(member => {
      const owner = this.db.prepare('SELECT owner_kind AS kind,owner_id AS id FROM agent_team_execution_links WHERE member_id=?').get(member.id) as ExecutionOwner | undefined
      if (!owner) return member
      const live = this.executions.forOwner(owner)
      return { ...member, connection: { owner, deliveryEnabled: this.delivery.has(member.id), state: live && this.connected.get(member.id) === live.id ? 'connected' as const : 'disconnected' as const } }
    }) }
  }

  async connectFromUi(teamId: string, revision: number, memberId: string, owner: ExecutionOwner): Promise<void> {
    if (!owner || !['thread', 'pane'].includes(owner.kind) || typeof owner.id !== 'string') throw Error('Invalid session owner')
    const execution = this.executions.forOwner(owner)
    if (!execution) throw Error('Start the agent session before connecting this member')
    const identity = await this.identify(execution.cwd)
    this.executions.authenticate(execution.id, execution.token, execution.workspaceId)
    this.db.transaction(() => {
      const team = this.repository.get(teamId)
      if (team.revision !== revision) throw Error('Team changed; refresh before connecting')
      if (identity !== team.projectIdentity || !team.members.some(m => m.id === memberId && !m.archived)) throw Error('Session does not belong to this team')
      const current = this.connected.get(memberId)
      const previous = this.db.prepare('SELECT owner_kind AS kind,owner_id AS id FROM agent_team_execution_links WHERE member_id=?').get(memberId) as ExecutionOwner | undefined
      if (current && current !== execution.id && previous && this.executions.forOwner(previous)?.id === current) throw Error('Disconnect the current member session first')
      this.db.prepare(`INSERT INTO agent_team_execution_links VALUES (?,?,?) ON CONFLICT(member_id) DO UPDATE SET owner_kind=excluded.owner_kind,owner_id=excluded.owner_id`)
        .run(memberId, owner.kind, owner.id)
      this.db.prepare('UPDATE agent_teams SET revision=revision+1 WHERE id=?').run(teamId)
    })()
    this.delivery.delete(memberId)
    this.connected.set(memberId, execution.id)
  }
  disconnectFromUi(teamId: string, revision: number, memberId: string): void {
    this.delivery.delete(memberId)
    this.db.transaction(() => {
      const team = this.repository.get(teamId)
      if (team.revision !== revision || !team.members.some(m => m.id === memberId)) throw Error('Team changed; refresh before disconnecting')
      this.db.prepare('DELETE FROM agent_team_execution_links WHERE member_id=?').run(memberId)
      this.db.prepare('UPDATE agent_teams SET revision=revision+1 WHERE id=?').run(teamId)
    })()
    this.connected.delete(memberId)
  }
  disableDelivery(memberId: string): void { this.delivery.delete(memberId) }
  setDeliveryFromUi(teamId: string, revision: number, memberId: string, enabled: boolean): void {
    const team = this.snapshotFromUi(teamId), member = team.members.find(m => m.id === memberId && !m.archived)
    if (team.revision !== revision || !member) throw Error('Team changed; refresh first')
    if (enabled && (member.connection?.state !== 'connected' || member.connection.owner.kind !== 'thread')) throw Error('Automatic delivery requires a connected Thread session. Code agents read the inbox through MCP.')
    if (enabled) {
      const row = this.db.prepare('SELECT data_json FROM conversation_threads WHERE id=?').get(member.connection!.owner.id) as { data_json: string } | undefined
      if (!row) throw Error('Thread is no longer available')
      const thread = JSON.parse(row.data_json) as { provider: string; access?: string }
      if (thread.provider === 'claude' && (!thread.access || thread.access === 'read-only')) throw Error('Claude read-only disables MCP. Choose native permissions before enabling Team delivery.')
    }
    if (enabled) this.delivery.add(memberId); else this.delivery.delete(memberId)
  }
  deliveryTargets(): { teamId: string; memberId: string; threadId: string }[] {
    const targets: { teamId: string; memberId: string; threadId: string }[] = []
    for (const memberId of this.delivery) {
      const row = this.db.prepare(`SELECT m.team_id AS teamId,l.owner_id AS threadId FROM agent_team_members m JOIN agent_team_execution_links l ON l.member_id=m.id WHERE m.id=? AND m.archived=0 AND l.owner_kind='thread'`).get(memberId) as { teamId: string; threadId: string } | undefined
      const live = row && this.executions.forOwner({ kind: 'thread', id: row.threadId })
      if (row && live && this.connected.get(memberId) === live.id) targets.push({ ...row, memberId })
      else this.delivery.delete(memberId)
    }
    return targets
  }
  async authorize(execution: AgentExecution) {
    this.executions.authenticate(execution.id, execution.token, execution.workspaceId)
    const identity = await this.identify(execution.cwd)
    this.executions.authenticate(execution.id, execution.token, execution.workspaceId)
    const row = this.db.prepare(`SELECT m.id,m.team_id AS teamId FROM agent_team_execution_links l
      JOIN agent_team_members m ON m.id=l.member_id JOIN agent_teams t ON t.id=m.team_id
      WHERE l.owner_kind=? AND l.owner_id=? AND m.archived=0 AND t.project_identity=?`)
      .get(execution.owner.kind, execution.owner.id, identity) as { id: string; teamId: string } | undefined
    if (!row || this.connected.get(row.id) !== execution.id) throw Error('Connect this session to a Team member in OXESpace first')
    const team = this.repository.get(row.teamId)
    return { team, member: team.members.find(m => m.id === row.id)! }
  }
}
