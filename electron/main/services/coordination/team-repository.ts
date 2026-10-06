import { createHash, randomUUID } from 'node:crypto'
import type { AppDatabase } from '../../db'
import type { AgentTeam, TeamBinding, TeamMember, TeamMessage, TeamMessageKind, TeamRole } from '../../../../shared/types/team'

const roles: TeamRole[] = ['coordinator', 'project-manager', 'product-manager', 'developer', 'reviewer']
const kinds: TeamMessageKind[] = ['request', 'progress', 'question', 'answer', 'result', 'decision']
function text(value: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || Buffer.byteLength(value) > max) throw Error('Invalid team field')
  return value.trim()
}
/** Persistence primitive. Callers must resolve canonical project identity and authorize
 * operations before entering here. Never expose repository methods directly to MCP. */
export class TeamRepository {
  constructor(private readonly db: AppDatabase, private readonly now = Date.now) {}
  ensure(projectIdentity: string, name: string): AgentTeam {
    const identity = text(projectIdentity, 4096), label = text(name, 120)
    this.db.prepare('INSERT OR IGNORE INTO agent_teams(id,project_identity,name,created_at) VALUES (?,?,?,?)')
      .run(randomUUID(), identity, label, this.now())
    const row = this.db.prepare('SELECT id FROM agent_teams WHERE project_identity=?').get(identity) as { id: string }
    return this.get(row.id)
  }
  get(id: string): AgentTeam {
    const row = this.db.prepare('SELECT id,project_identity AS projectIdentity,name,revision FROM agent_teams WHERE id=?').get(id) as Omit<AgentTeam, 'members'> | undefined
    if (!row) throw Error('Team not found')
    const members = this.db.prepare('SELECT id,team_id AS teamId,name,role,archived FROM agent_team_members WHERE team_id=? ORDER BY created_at,id').all(id) as Array<Omit<TeamMember, 'archived'> & { archived: number }>
    return { ...row, members: members.map(m => ({ ...m, archived: Boolean(m.archived) })) }
  }
  private mutate<T>(teamId: string, revision: number, action: () => T): T {
    return this.db.transaction(() => {
      if (!Number.isSafeInteger(revision) || this.db.prepare('UPDATE agent_teams SET revision=revision+1 WHERE id=? AND revision=?').run(teamId, revision).changes !== 1) throw Error('Team changed; refresh before editing')
      return action()
    })()
  }
  private member(teamId: string, memberId: string): TeamMember {
    const member = this.get(teamId).members.find(m => m.id === memberId && !m.archived)
    if (!member) throw Error('Active team member not found')
    return member
  }
  add(teamId: string, revision: number, name: string, role: TeamRole): AgentTeam {
    const label = text(name, 120)
    if (!roles.includes(role)) throw Error('Invalid team role')
    return this.mutate(teamId, revision, () => {
      if (this.get(teamId).members.filter(m => !m.archived).length >= 32) throw Error('Team member limit reached')
      this.db.prepare('INSERT INTO agent_team_members(id,team_id,name,role,created_at) VALUES (?,?,?,?,?)').run(randomUUID(), teamId, label, role, this.now())
      return this.get(teamId)
    })
  }
  replaceCoordinator(teamId: string, revision: number, memberId: string): AgentTeam {
    return this.mutate(teamId, revision, () => {
      this.member(teamId, memberId)
      this.db.prepare("UPDATE agent_team_members SET role='developer' WHERE team_id=? AND role='coordinator' AND archived=0").run(teamId)
      this.db.prepare("UPDATE agent_team_members SET role='coordinator' WHERE id=?").run(memberId)
      return this.get(teamId)
    })
  }
  archive(teamId: string, revision: number, memberId: string): AgentTeam {
    return this.mutate(teamId, revision, () => {
      this.member(teamId, memberId)
      this.db.prepare('DELETE FROM agent_team_bindings WHERE member_id=?').run(memberId)
      this.db.prepare('DELETE FROM agent_team_execution_links WHERE member_id=?').run(memberId)
      this.db.prepare('UPDATE agent_team_members SET archived=1 WHERE id=?').run(memberId)
      return this.get(teamId)
    })
  }
  binding(memberId: string): TeamBinding | undefined {
    return this.db.prepare(`SELECT member_id AS memberId,provider,native_session_id AS nativeSessionId,canonical_root AS canonicalRoot,
      surface,surface_id AS surfaceId,generation FROM agent_team_bindings WHERE member_id=?`).get(memberId) as TeamBinding | undefined
  }
  /** Records verified ownership; it grants neither process control nor a writer lease. */
  bind(teamId: string, revision: number, input: TeamBinding): AgentTeam {
    if (!['codex', 'claude'].includes(input.provider) || !['thread', 'pane'].includes(input.surface) || !Number.isSafeInteger(input.generation) || input.generation < 1) throw Error('Invalid session binding')
    const native = text(input.nativeSessionId, 256), root = text(input.canonicalRoot, 4096), surface = text(input.surfaceId, 256)
    return this.mutate(teamId, revision, () => {
      this.member(teamId, input.memberId)
      const current = this.binding(input.memberId)
      if (current && input.generation <= current.generation) throw Error('Session binding generation must advance')
      this.db.prepare(`INSERT INTO agent_team_bindings VALUES (?,?,?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET
        provider=excluded.provider,native_session_id=excluded.native_session_id,canonical_root=excluded.canonical_root,
        surface=excluded.surface,surface_id=excluded.surface_id,generation=excluded.generation`)
        .run(input.memberId, input.provider, native, root, input.surface, surface, input.generation)
      return this.get(teamId)
    })
  }
  send(input: { teamId: string; senderId: string | null; recipientId: string; key: string; kind: TeamMessageKind; body: string; replyTo?: string }): TeamMessage {
    const body = text(input.body, 16384), key = text(input.key, 160)
    if (!kinds.includes(input.kind)) throw Error('Invalid message kind')
    return this.db.transaction(() => {
      this.member(input.teamId, input.recipientId)
      if (input.senderId !== null) this.member(input.teamId, input.senderId)
      const payload = createHash('sha256').update(JSON.stringify([input.recipientId, input.kind, body, input.replyTo ?? null])).digest('hex')
      const existing = this.db.prepare('SELECT id,payload_hash AS hash FROM agent_team_messages WHERE team_id=? AND sender_id IS ? AND request_key=?').get(input.teamId, input.senderId, key) as { id: string; hash: string } | undefined
      if (existing) {
        if (existing.hash !== payload) throw Error('Message key already used for different content')
        return this.message(existing.id)
      }
      if (input.replyTo) {
        const original = this.message(input.replyTo)
        if (original.teamId !== input.teamId || original.recipientId !== input.senderId || original.senderId !== input.recipientId) throw Error('Reply does not match message participants')
      }
      const id = randomUUID()
      this.db.prepare(`INSERT INTO agent_team_messages(id,team_id,sender_id,recipient_id,request_key,payload_hash,kind,body,created_at,reply_to)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, input.teamId, input.senderId, input.recipientId, key, payload, input.kind, body, this.now(), input.replyTo ?? null)
      return this.message(id)
    })()
  }
  private message(id: string): TeamMessage {
    const row = this.db.prepare(`SELECT sequence,id,team_id AS teamId,sender_id AS senderId,recipient_id AS recipientId,
      kind,body,created_at AS createdAt,received_at AS receivedAt,reply_to AS replyTo FROM agent_team_messages WHERE id=?`).get(id) as TeamMessage | undefined
    if (!row) throw Error('Message not found')
    const delivery = this.db.prepare('SELECT state FROM agent_team_deliveries WHERE message_id=?').get(id) as { state: TeamMessage['deliveryState'] } | undefined
    return { ...row, ...(delivery ? { deliveryState: delivery.state } : {}) }
  }
  inbox(teamId: string, memberId: string, after = 0, limit = 50): TeamMessage[] {
    this.member(teamId, memberId)
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('Invalid inbox page')
    const rows = this.db.prepare('SELECT id FROM agent_team_messages WHERE team_id=? AND recipient_id=? AND sequence>? ORDER BY sequence LIMIT ?').all(teamId, memberId, after, limit) as { id: string }[]
    return rows.map(row => this.message(row.id))
  }
  acknowledge(teamId: string, memberId: string, id: string): void {
    this.member(teamId, memberId)
    if (this.db.prepare('UPDATE agent_team_messages SET received_at=COALESCE(received_at,?) WHERE id=? AND team_id=? AND recipient_id=?').run(this.now(), id, teamId, memberId).changes !== 1) throw Error('Message does not belong to recipient')
  }
  activity(teamId: string, memberId: string, before = Number.MAX_SAFE_INTEGER): TeamMessage[] {
    this.member(teamId, memberId)
    if (!Number.isSafeInteger(before) || before < 1) throw Error('Invalid activity page')
    const rows = this.db.prepare(`SELECT id FROM agent_team_messages WHERE team_id=? AND (sender_id=? OR recipient_id=?)
      AND sequence<? ORDER BY sequence DESC LIMIT 50`).all(teamId, memberId, memberId, before) as { id: string }[]
    return rows.reverse().map(row => this.message(row.id))
  }
}
