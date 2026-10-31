import { basename } from 'node:path'
import type { AppDatabase } from '../../db'
import { mainMessage } from '../../../../shared/messages'
import type { ProjectCoordinatorOptions, ProjectCoordinatorOutcome, ProjectCoordinatorToken } from '../../../../shared/types/thread'
import type { TeamRole } from '../../../../shared/types/team'
import type { ExecutionOwner } from '../execution-registry'
import { MainRefusal } from '../main-refusal'
import { projectIdentity } from '../memory/memory-project.service'
import { TeamRepository } from '../coordination/team-repository'
import type { TeamAccess } from '../coordination/team-access'
import { tMain } from '../../i18n'
import { coordinatorIds, isThreadCoordinator } from './thread-coordinator'
import { readThreadTitle } from './thread-title'
import { unarchived } from './coordinator-authority'

/**
 * The one write path for the project's coordinator (B1.4 · S7.5), from a conversation and from the Team.
 *
 * Invariant: when the Team's active coordinator member is connected to an existing, unarchived conversation, that
 * conversation is the project coordinator for the Team's project identity; an identity has at most one. A member
 * bound to a Code pane is a label only. The identity is projectIdentity() of the conversation's
 * `thread_projects.root_path`, as the Team's IPC resolves it, never the stored `thread_projects.identity`.
 *
 * Each change resolves the identity first (Git, outside the transaction), then reads and writes in one transaction,
 * re-reading the project root (`thread.coordinator.projectChanged`). A failed Git probe refuses
 * (`thread.coordinator.identityUnavailable`) and never falls back to a path. A preview runs the same transaction and
 * rolls it back, so it shows exactly what the confirmation would do; the confirmation hands back the preview's token
 * and is refused (`thread.coordinator.changed`) when it moved. A refusal writes nothing.
 *
 * Rules, from a conversation X (setForThread):
 * 1. Mark X connected to member M of the identity's Team: M becomes the coordinator, the previous one takes M's role.
 * 2. Mark X, not a member, while the Team's coordinator is connected to another conversation: refused.
 * 3. Unmark X while it is the Team coordinator's conversation: refused.
 * From the Team (setMemberCoordinator, connectMember, teamChange):
 * 4. Make M the coordinator: the row becomes M's conversation, or, with M on a pane or unconnected, the row of the
 *    previous coordinator's conversation is removed. Connecting the coordinator to a conversation moves the row there.
 * 5. Disconnecting or archiving the coordinator member keeps the row: the conversation stays the person's choice.
 *    Archiving a conversation removes its row (ThreadManager.command); deleting it cascades.
 * A change from a conversation that touches the Team bumps its revision, so an open Team panel refreshes.
 * There is no Team delete; one added later goes through here. Links survive a restart (consent does not), so the
 * role does too, while Team messaging waits for a reconnect.
 */

type Identify = (root: string) => Promise<string>
interface Conversation { id: string; root: string; archived: boolean; title: string; rootPath: string }
interface Member { id: string; name: string; role: TeamRole; threadId?: string }
interface TeamState { id: string; revision: number; members: Member[]; coordinator?: Member }
interface Step { identity: string; team: TeamState | undefined; start: ProjectCoordinatorToken; swap?: ProjectCoordinatorOutcome['swap']; bumped?: boolean }

const PREVIEW = Symbol('preview')

function conversation(db: AppDatabase, id: string): Conversation | undefined {
  const row = db.prepare(`SELECT t.id, p.root_path AS root, COALESCE(json_extract(t.data_json, '$.archived'), 0) AS archived,
    json_extract(t.data_json, '$.title') AS title, json_extract(t.data_json, '$.rootPath') AS rootPath
    FROM conversation_threads t JOIN thread_projects p ON p.id = t.thread_project_id WHERE t.id = ?`).get(id) as
    { id: string; root: string; archived: number; title: unknown; rootPath: unknown } | undefined
  return row && { id: row.id, root: row.root, archived: Boolean(row.archived), title: readThreadTitle(typeof row.title === 'string' ? row.title : ''),
    rootPath: typeof row.rootPath === 'string' ? row.rootPath : row.root }
}

/** The identity's Team, with each active member and the existing, unarchived conversation it is connected to. */
function teamState(db: AppDatabase, identity: string): TeamState | undefined {
  const team = db.prepare('SELECT id, revision FROM agent_teams WHERE project_identity = ?').get(identity) as { id: string; revision: number } | undefined
  if (!team) return undefined
  const members = (db.prepare(`SELECT m.id, m.name, m.role,
      CASE WHEN l.owner_kind = 'thread' AND EXISTS (SELECT 1 FROM conversation_threads t WHERE t.id = l.owner_id AND ${unarchived('t')}) THEN l.owner_id END AS threadId
      FROM agent_team_members m LEFT JOIN agent_team_execution_links l ON l.member_id = m.id WHERE m.team_id = ? AND m.archived = 0`).all(team.id) as
    { id: string; name: string; role: TeamRole; threadId: string | null }[])
    .map(row => ({ id: row.id, name: row.name, role: row.role, ...(row.threadId ? { threadId: row.threadId } : {}) }))
  return { ...team, members, coordinator: members.find(member => member.role === 'coordinator') }
}

const roleName = (role: TeamRole): string => (tMain as unknown as (key: string) => string)(`teamRoles.${role}`)
const elsewhere = (member: Member) => new MainRefusal('thread.coordinator.teamCoordinatorElsewhere', { member: member.name })

export class ProjectCoordinatorService {
  private readonly teams: TeamRepository
  constructor(private readonly db: AppDatabase, private readonly identify: Identify = projectIdentity, private readonly now = Date.now) {
    this.teams = new TeamRepository(db)
  }

  /** Rules 1–3: the person marks or unmarks a conversation (thread:set-coordinator). */
  async setForThread(threadId: string, coordinator: boolean, options: ProjectCoordinatorOptions = {}): Promise<ProjectCoordinatorOutcome> {
    const resolved = conversation(this.db, threadId)
    if (!resolved) throw Error('Thread not found')
    const identity = await this.resolve(resolved.root)
    return this.run(options, () => {
      const current = conversation(this.db, threadId)
      if (!current) throw Error('Thread not found')
      if (current.root !== resolved.root) throw new MainRefusal('thread.coordinator.projectChanged', {})
      const team = teamState(this.db, identity)
      const start = this.check(options.expect, identity, team)
      let swap: ProjectCoordinatorOutcome['swap']
      if (coordinator) {
        if (current.archived) throw Error('An archived conversation cannot coordinate its project')
        const member = team?.members.find(m => m.threadId === threadId)
        if (member) swap = this.swap(team!.id, member.id)
        else if (team?.coordinator?.threadId && team.coordinator.threadId !== threadId) throw elsewhere(team.coordinator)
        this.place(identity, threadId, current.root)
      } else {
        if (team?.coordinator?.threadId === threadId) throw elsewhere(team.coordinator)
        this.db.prepare('DELETE FROM project_coordinators WHERE thread_id = ?').run(threadId)
      }
      return { identity, team, start, swap }
    })
  }

  /** Rule 4: the Team makes member M its coordinator (team:command coordinator). */
  async setMemberCoordinator(teamId: string, revision: number, memberId: string, options: ProjectCoordinatorOptions = {}): Promise<ProjectCoordinatorOutcome> {
    const { projectIdentity: identity } = this.teams.get(teamId)
    const link = this.link(memberId)
    const target = link?.kind === 'thread' ? await this.target(link.id, identity) : undefined
    return this.run(options, () => {
      if (this.teams.get(teamId).revision !== revision) throw Error('Team changed; refresh before editing')
      const now = this.link(memberId)
      if (now?.kind !== link?.kind || now?.id !== link?.id) throw new MainRefusal('thread.coordinator.changed', {})
      this.checkTarget(target)
      const team = teamState(this.db, identity)!
      const start = this.check(options.expect, identity, team)
      const previousThread = team.coordinator?.id !== memberId ? team.coordinator?.threadId : undefined
      const swap = this.swap(teamId, memberId)
      if (target) this.place(identity, target.threadId, target.root)
      else if (previousThread) this.db.prepare('DELETE FROM project_coordinators WHERE project_identity = ? AND thread_id = ?').run(identity, previousThread)
      this.bump(teamId)
      return { identity, team, start, swap, bumped: true }
    })
  }

  /** Rule 4: connecting the coordinator member to a conversation W, from a pane or from conversation Z, moves the row to W. */
  async connectMember(access: TeamAccess, teamId: string, revision: number, memberId: string, owner: ExecutionOwner, options: ProjectCoordinatorOptions = {}): Promise<ProjectCoordinatorOutcome> {
    const { projectIdentity: identity } = this.teams.get(teamId)
    const target = owner?.kind === 'thread' && typeof owner.id === 'string' ? await this.target(owner.id, identity) : undefined
    const follow = (): Step => {
      this.checkTarget(target)
      const team = teamState(this.db, identity)
      if (!team || team.revision !== revision) throw Error('Team changed; refresh before connecting')
      const start = this.check(options.expect, identity, team)
      if (target && team.coordinator?.id === memberId) this.place(identity, target.threadId, target.root)
      return { identity, team, start, bumped: true }
    }
    if (options.preview) {
      return this.run(options, () => {
        const step = follow()
        this.db.prepare('INSERT INTO agent_team_execution_links VALUES (?,?,?) ON CONFLICT(member_id) DO UPDATE SET owner_kind=excluded.owner_kind,owner_id=excluded.owner_id')
          .run(memberId, owner.kind, owner.id)
        return step
      })
    }
    const before = coordinatorIds(this.db)
    await access.connectFromUi(teamId, revision, memberId, owner, () => { follow() })
    return this.outcome(before, identity)
  }

  /**
   * Rule 5: disconnecting or archiving a member. The row stays, so the conversation keeps the role the person gave it;
   * the change notices still cover a conversation whose authority the Team's precedence was holding back.
   * `simulate` is the change's database effect alone, for the preview.
   */
  teamChange(teamId: string, change: () => void, simulate: () => void, options: ProjectCoordinatorOptions = {}): ProjectCoordinatorOutcome {
    const { projectIdentity: identity } = this.teams.get(teamId)
    return this.run(options, () => {
      const team = teamState(this.db, identity)
      const start = this.check(options.expect, identity, team)
      if (options.preview) simulate(); else change()
      return { identity, team, start, bumped: true }
    })
  }

  private async resolve(root: string): Promise<string> {
    try { return await this.identify(root) } catch { throw new MainRefusal('thread.coordinator.identityUnavailable', {}) }
  }

  /** A conversation the coordinator member is connected to, when it exists, is not archived and is of the Team's identity. */
  private async target(threadId: string, identity: string): Promise<{ threadId: string; root: string } | undefined> {
    const found = conversation(this.db, threadId)
    if (!found || found.archived) return undefined
    return await this.resolve(found.root) === identity ? { threadId, root: found.root } : undefined
  }

  private checkTarget(target: { threadId: string; root: string } | undefined): void {
    if (target && conversation(this.db, target.threadId)?.root !== target.root) throw new MainRefusal('thread.coordinator.projectChanged', {})
  }

  private link(memberId: string): { kind: 'thread' | 'pane'; id: string } | undefined {
    return this.db.prepare('SELECT owner_kind AS kind, owner_id AS id FROM agent_team_execution_links WHERE member_id = ?').get(memberId) as { kind: 'thread' | 'pane'; id: string } | undefined
  }

  private token(identity: string, team: Pick<TeamState, 'revision'> | undefined): ProjectCoordinatorToken {
    const row = this.db.prepare('SELECT thread_id FROM project_coordinators WHERE project_identity = ?').get(identity) as { thread_id: string } | undefined
    return { identity, teamRevision: team?.revision ?? null, coordinatorThreadId: row?.thread_id ?? null }
  }

  /** The state this change starts from; refused when the preview the person confirmed saw another one. */
  private check(expect: ProjectCoordinatorToken | undefined, identity: string, team: TeamState | undefined): ProjectCoordinatorToken {
    const token = this.token(identity, team)
    if (expect && (expect.identity !== token.identity || expect.teamRevision !== token.teamRevision || expect.coordinatorThreadId !== token.coordinatorThreadId)) {
      throw new MainRefusal('thread.coordinator.changed', {})
    }
    return token
  }

  private swap(teamId: string, memberId: string): ProjectCoordinatorOutcome['swap'] {
    const { member, previous } = this.teams.swapCoordinator(teamId, memberId)
    return previous && { promoted: member.name, demoted: previous.name, demotedRole: member.role,
      message: mainMessage('thread.coordinator.swap', { member: member.name, previous: previous.name, role: roleName(member.role) }) }
  }

  /** The identity's row becomes this conversation's; it leaves any other identity's row first (thread_id is unique). */
  private place(identity: string, threadId: string, root: string): void {
    this.db.prepare('DELETE FROM project_coordinators WHERE thread_id = ? AND project_identity <> ?').run(threadId, identity)
    this.db.prepare(`INSERT INTO project_coordinators (project_identity, thread_id, root_path, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(project_identity) DO UPDATE SET thread_id = excluded.thread_id, root_path = excluded.root_path, updated_at = excluded.updated_at`)
      .run(identity, threadId, root, this.now())
  }

  private bump(teamId: string): void { this.db.prepare('UPDATE agent_teams SET revision = revision + 1 WHERE id = ?').run(teamId) }

  /** One transaction; a preview rolls it back and returns what it would have done, with the token it started from. */
  private run(options: ProjectCoordinatorOptions, body: () => Step): ProjectCoordinatorOutcome {
    let outcome: ProjectCoordinatorOutcome | undefined
    try {
      this.db.transaction(() => {
        const before = coordinatorIds(this.db)
        const step = body()
        const changed = this.changed(before)
        if (!step.bumped && step.team && (changed.length || step.swap)) this.bump(step.team.id)
        outcome = this.outcome(before, step.identity, step.swap)
        if (options.preview) { outcome.token = step.start; throw PREVIEW }
      })()
    } catch (error) { if (error !== PREVIEW) throw error }
    return outcome!
  }

  private changed(before: Set<string>): string[] {
    const after = coordinatorIds(this.db)
    return [...[...before].filter(id => !after.has(id)), ...[...after].filter(id => !before.has(id))]
  }

  private outcome(before: Set<string>, identity: string, swap?: ProjectCoordinatorOutcome['swap']): ProjectCoordinatorOutcome {
    const changed = this.changed(before)
    const lost = changed.find(id => before.has(id))
    const previous = lost ? conversation(this.db, lost) : undefined
    return { changed, ...(swap ? { swap } : {}),
      ...(previous ? { previous: { threadId: previous.id, title: previous.title, rootPath: previous.rootPath, ...(previous.rootPath !== previous.root ? { worktree: basename(previous.rootPath) } : {}) } } : {}),
      token: this.token(identity, teamState(this.db, identity)) }
  }
}

/**
 * The boot pass, after migrations, safe to run again: drops rows the authority check no longer grants (an archived
 * or moved conversation, a Team coordinator connected elsewhere) or whose root now resolves to another identity, then
 * gives each Team whose active coordinator is connected to an existing, unarchived conversation of its identity that
 * row (the backfill, which needs Git and so cannot run inside the SQL migration). A Git probe that fails keeps a row
 * and skips a backfill; it never decides on a path. Returns the conversations whose flag changed.
 */
export async function reconcileProjectCoordinators(db: AppDatabase, identify: Identify = projectIdentity, now = Date.now()): Promise<string[]> {
  const before = coordinatorIds(db)
  const rows = db.prepare('SELECT project_identity AS identity, thread_id AS threadId, root_path AS root FROM project_coordinators').all() as { identity: string; threadId: string; root: string }[]
  for (const row of rows) {
    let drift = !isThreadCoordinator(db, row.threadId)
    if (!drift) { try { drift = await identify(row.root) !== row.identity } catch { drift = false } }
    if (drift) db.prepare('DELETE FROM project_coordinators WHERE thread_id = ? AND project_identity = ? AND root_path = ?').run(row.threadId, row.identity, row.root)
  }
  const links = db.prepare(`SELECT team.project_identity AS identity, link.owner_id AS threadId, p.root_path AS root
    FROM agent_teams team
    JOIN agent_team_members member ON member.team_id = team.id AND member.role = 'coordinator' AND member.archived = 0
    JOIN agent_team_execution_links link ON link.member_id = member.id AND link.owner_kind = 'thread'
    JOIN conversation_threads t ON t.id = link.owner_id AND ${unarchived('t')}
    JOIN thread_projects p ON p.id = t.thread_project_id`).all() as { identity: string; threadId: string; root: string }[]
  for (const link of links) {
    let identity: string
    try { identity = await identify(link.root) } catch { continue }
    if (identity !== link.identity) continue
    db.transaction(() => {
      const current = conversation(db, link.threadId)
      if (current && !current.archived && current.root === link.root) {
        db.prepare('INSERT OR IGNORE INTO project_coordinators (project_identity, thread_id, root_path, updated_at) VALUES (?, ?, ?, ?)').run(identity, link.threadId, link.root, now)
      }
    })()
  }
  const after = coordinatorIds(db)
  return [...[...before].filter(id => !after.has(id)), ...[...after].filter(id => !before.has(id))]
}
