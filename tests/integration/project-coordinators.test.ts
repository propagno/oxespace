import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ProjectCoordinatorService, reconcileProjectCoordinators } from '../../electron/main/services/conversation/project-coordinators'
import { coordinatorIds, coordinatorPendingRequests, isThreadCoordinator, threadActionRoles } from '../../electron/main/services/conversation/thread-coordinator'
import { EFFECTIVE_COORDINATORS } from '../../electron/main/services/conversation/coordinator-authority'
import { threadToolRoles } from '../../electron/main/services/conversation/thread-mcp'
import { projectToolModes, sessionToolPlan } from '../../electron/main/services/conversation/tool-groups'
import { ThreadProjectService } from '../../electron/main/services/conversation/thread-projects'
import { ThreadHistory } from '../../electron/main/services/conversation/thread-history'
import { TeamRepository } from '../../electron/main/services/coordination/team-repository'
import { TeamAccess } from '../../electron/main/services/coordination/team-access'
import { ExecutionRegistry } from '../../electron/main/services/execution-registry'
import { MainRefusal } from '../../electron/main/services/main-refusal'
import type { IdentityGuard } from '../../electron/main/services/conversation/identity-guard'
import { projectIdentity } from '../../electron/main/services/memory/memory-project.service'
import { setMainLanguage } from '../../electron/main/i18n'
import type { TeamRole } from '../../shared/types/team'

// Role names in the swap notice come from the `teamRoles` table, in the interface's language.
process.env.OXESPACE_LOCALE = 'en'

const cleanup: (() => void)[] = []
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn() })

/**
 * p1 (/repo) and p2 (/alias) are two thread projects of one repository (legacy duplicates: one identity); p3 is
 * another repository. Git stands aside: `identify` is a table, and a root it does not know fails like a timed-out probe.
 */
function fixture() {
  const db = openInMemoryDatabase()
  cleanup.push(() => db.close())
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws', 'Repo', '/repo', '1x1', 'builtin-claude')").run()
  const projects: Record<string, string> = { p1: '/repo', p2: '/alias', p3: '/other', p4: '/nogit' }
  for (const [id, root] of Object.entries(projects)) {
    // The stored identity is wrong on purpose: nothing may trust it.
    db.prepare('INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)').run(id, `stored:${id}`, root, id)
  }
  const identities = new Map([['/repo', 'id-repo'], ['/alias', 'id-repo'], ['/other', 'id-other']])
  const identify = vi.fn(async (root: string) => { const identity = identities.get(root); if (!identity) throw Error('git rev-parse timed out'); return identity })
  const guard = vi.fn<IdentityGuard>(async () => 'ok')
  const service = new ProjectCoordinatorService(db, identify, guard)
  const thread = (id: string, project = 'p1', data: Record<string, unknown> = {}) => db.prepare("INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, 'ws', ?, ?, '[]')")
    .run(id, project, JSON.stringify({ id, title: `Conversation ${id}`, rootPath: projects[project], status: 'idle', ...data }))
  const archive = (id: string) => db.prepare("UPDATE conversation_threads SET data_json = json_set(data_json, '$.archived', json('true')) WHERE id = ?").run(id)
  const teams = new TeamRepository(db)
  const team = (identity = 'id-repo', members: [string, TeamRole][] = [['Ana', 'coordinator'], ['Bia', 'developer'], ['Caio', 'reviewer']]) => {
    let value = teams.ensure(identity, 'Repo')
    for (const [name, role] of members) value = teams.add(value.id, value.revision, name, role)
    return value.id
  }
  const member = (teamId: string, name: string) => teams.get(teamId).members.find(m => m.name === name)!.id
  const link = (memberId: string, kind: 'thread' | 'pane', ownerId: string) => db.prepare(`INSERT INTO agent_team_execution_links VALUES (?, ?, ?)
    ON CONFLICT(member_id) DO UPDATE SET owner_kind = excluded.owner_kind, owner_id = excluded.owner_id`).run(memberId, kind, ownerId)
  const revision = (teamId: string) => teams.get(teamId).revision
  const roles = (teamId: string) => Object.fromEntries(teams.get(teamId).members.filter(m => !m.archived).map(m => [m.name, m.role]))
  const rows = () => db.prepare('SELECT project_identity AS identity, thread_id AS threadId FROM project_coordinators ORDER BY project_identity').all()
  /** Everything a refusal must leave untouched. */
  const state = () => JSON.stringify(['project_coordinators', 'agent_teams', 'agent_team_members', 'agent_team_execution_links']
    .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()))
  return { db, service, identify, guard, identities, thread, archive, teams, team, member, link, revision, roles, rows, state }
}

/**
 * The invariant, after every write: a Team whose active coordinator is connected to an existing, unarchived
 * conversation has that conversation as its identity's coordinator, and an identity has at most one.
 */
function invariant(db: AppDatabase): void {
  const links = db.prepare(`SELECT team.project_identity AS identity, link.owner_id AS threadId FROM agent_teams team
    JOIN agent_team_members m ON m.team_id = team.id AND m.role = 'coordinator' AND m.archived = 0
    JOIN agent_team_execution_links link ON link.member_id = m.id AND link.owner_kind = 'thread'
    JOIN conversation_threads t ON t.id = link.owner_id AND COALESCE(json_extract(t.data_json, '$.archived'), 0) = 0`).all() as { identity: string; threadId: string }[]
  const granted = coordinatorIds(db)
  for (const link of links) {
    expect(db.prepare('SELECT thread_id AS threadId FROM project_coordinators WHERE project_identity = ?').get(link.identity), link.identity).toEqual({ threadId: link.threadId })
    expect(granted.has(link.threadId), link.threadId).toBe(true)
  }
  const identities = (db.prepare(`SELECT pc.project_identity AS identity ${EFFECTIVE_COORDINATORS}`).all() as { identity: string }[]).map(row => row.identity)
  expect(new Set(identities).size).toBe(identities.length)
}

const refusal = (code: string, params: Record<string, unknown> = {}) => expect.objectContaining({ message: code, code, params })

describe('project_coordinators: one coordinator per project identity (B1.4 · S7.5)', () => {
  it('keys the row by identity, so the table itself refuses a second coordinator for one repository', async () => {
    const f = fixture()
    f.thread('x'); f.thread('y')
    await f.service.setForThread('x', true)
    expect(f.rows()).toEqual([{ identity: 'id-repo', threadId: 'x' }])
    expect(f.db.prepare('SELECT root_path FROM project_coordinators').get()).toEqual({ root_path: '/repo' })
    expect(() => f.db.prepare("INSERT INTO project_coordinators (project_identity, thread_id, root_path, updated_at) VALUES ('id-repo', 'y', '/repo', 1)").run()).toThrow(/UNIQUE|PRIMARY/)
    expect(() => f.db.prepare("INSERT INTO project_coordinators (project_identity, thread_id, root_path, updated_at) VALUES ('id-other', 'x', '/other', 1)").run()).toThrow(/UNIQUE/)
    // The identity came from the project's root, never from the stored thread_projects.identity.
    expect(f.identify).toHaveBeenCalledWith('/repo')
    expect(JSON.stringify(f.rows())).not.toContain('stored:')
  })

  it('gives two thread projects of one identity one coordinator, which sees its own project\'s pending requests', async () => {
    const f = fixture()
    f.thread('x', 'p1'); f.thread('y', 'p2'); f.thread('o', 'p3')
    await f.service.setForThread('x', true)
    await f.service.setForThread('o', true)
    const moved = await f.service.setForThread('y', true)
    expect(moved.changed.sort()).toEqual(['x', 'y'])
    expect(moved.previous).toMatchObject({ threadId: 'x', title: 'Conversation x' })
    expect([...coordinatorIds(f.db)].sort()).toEqual(['o', 'y'])
    expect(f.rows()).toEqual([{ identity: 'id-other', threadId: 'o' }, { identity: 'id-repo', threadId: 'y' }])
    invariant(f.db)
    // Pending stays on the coordinator conversation's own thread project (change 9).
    const spy = vi.spyOn(ThreadHistory.prototype, 'pendingRequestsAll')
    coordinatorPendingRequests(f.db, 'y')
    expect(spy).toHaveBeenCalledWith(201, { projectId: 'p2' })
    spy.mockRestore()
  })
})

describe('rules from a conversation (B1.4 · S7.5)', () => {
  /** A Team on id-repo: Ana coordinates in y (a worktree), Bia develops in x, Caio reviews on a pane. */
  async function teamed() {
    const f = fixture()
    f.thread('x'); f.thread('y', 'p1', { rootPath: '/repo/.worktrees/feat-a' }); f.thread('z')
    const team = f.team()
    f.link(f.member(team, 'Ana'), 'thread', 'y'); f.link(f.member(team, 'Bia'), 'thread', 'x'); f.link(f.member(team, 'Caio'), 'pane', 'pane-1')
    expect(await reconcileProjectCoordinators(f.db, f.identify, f.guard)).toEqual(['y'])
    invariant(f.db)
    return { ...f, team }
  }

  it('rule 1: marking a member\'s conversation swaps the roles, stated in a preview that writes nothing', async () => {
    const f = await teamed()
    const before = f.state(), revision = f.revision(f.team)
    const preview = await f.service.setForThread('x', true, { preview: true })
    expect(f.state()).toBe(before)
    expect(preview).toEqual({
      changed: ['y', 'x'],
      swap: { promoted: 'Bia', demoted: 'Ana', demotedRole: 'developer', message: { code: 'thread.coordinator.swap', params: { member: 'Bia', previous: 'Ana', role: 'developer' } } },
      // The conversation that loses the role, with its worktree.
      previous: { threadId: 'y', title: 'Conversation y', rootPath: '/repo/.worktrees/feat-a', worktree: 'feat-a' },
      token: { identity: 'id-repo', teamRevision: revision, coordinatorThreadId: 'y' }
    })
    const done = await f.service.setForThread('x', true, { expect: preview.token })
    expect(done.changed).toEqual(['y', 'x'])
    expect(f.roles(f.team)).toEqual({ Ana: 'developer', Bia: 'coordinator', Caio: 'reviewer' })
    expect(f.rows()).toEqual([{ identity: 'id-repo', threadId: 'x' }])
    expect(f.revision(f.team)).toBe(revision + 1)
    expect(done.token).toEqual({ identity: 'id-repo', teamRevision: revision + 1, coordinatorThreadId: 'x' })
    invariant(f.db)
  })

  it('names the role in the person\'s language, from the teamRoles table', async () => {
    const f = await teamed()
    setMainLanguage('pt-BR')
    try {
      expect((await f.service.setForThread('x', true, { preview: true })).swap?.message).toEqual({ code: 'thread.coordinator.swap', params: { member: 'Bia', previous: 'Ana', role: 'desenvolvedor' } })
    } finally { setMainLanguage('en') }
  })

  it('rule 1 with no Team coordinator promotes the member and swaps nothing', async () => {
    const f = fixture()
    f.thread('x')
    const team = f.team('id-repo', [['Bia', 'developer']])
    f.link(f.member(team, 'Bia'), 'thread', 'x')
    const done = await f.service.setForThread('x', true)
    expect(done.swap).toBeUndefined()
    expect(f.roles(team)).toEqual({ Bia: 'coordinator' })
    invariant(f.db)
  })

  it('rule 1 counts a member only when its Team is of the conversation\'s identity', async () => {
    const f = fixture()
    f.thread('x')
    const other = f.team('id-other', [['Ana', 'coordinator'], ['Bia', 'developer']])
    f.link(f.member(other, 'Bia'), 'thread', 'x') // an old link from another repository
    expect((await f.service.setForThread('x', true)).swap).toBeUndefined()
    expect(f.roles(other)).toEqual({ Ana: 'coordinator', Bia: 'developer' })
    expect(f.rows()).toEqual([{ identity: 'id-repo', threadId: 'x' }])
  })

  it('rule 2: marking a conversation that is not a member, while the coordinator works in another one, is refused with nothing written', async () => {
    const f = await teamed()
    const before = f.state()
    await expect(f.service.setForThread('z', true)).rejects.toEqual(refusal('thread.coordinator.teamCoordinatorElsewhere', { member: 'Ana' }))
    await expect(f.service.setForThread('z', true, { preview: true })).rejects.toBeInstanceOf(MainRefusal)
    expect(f.state()).toBe(before)
    invariant(f.db)
    // An archived or deleted conversation of the coordinator no longer holds the role back.
    f.archive('y')
    await f.service.setForThread('z', true)
    expect(f.rows()).toEqual([{ identity: 'id-repo', threadId: 'z' }])
    invariant(f.db)
    f.db.prepare("DELETE FROM conversation_threads WHERE id = 'z'").run()
    expect(f.rows()).toEqual([])
  })

  it('rule 3: unmarking the coordinator\'s own conversation is refused with nothing written', async () => {
    const f = await teamed()
    const before = f.state()
    await expect(f.service.setForThread('y', false)).rejects.toEqual(refusal('thread.coordinator.teamCoordinatorHere', { member: 'Ana' }))
    expect(f.state()).toBe(before)
    invariant(f.db)
  })

  it('refuses a stale preview (change 8): the Team, the coordinator or the identity moved in between', async () => {
    const f = await teamed()
    const preview = await f.service.setForThread('x', true, { preview: true })
    f.teams.add(f.team, f.revision(f.team), 'Duda', 'reviewer') // someone edits the Team meanwhile
    const before = f.state()
    await expect(f.service.setForThread('x', true, { expect: preview.token })).rejects.toEqual(refusal('thread.coordinator.changed'))
    await expect(f.service.setForThread('x', true, { expect: { ...preview.token, teamRevision: f.revision(f.team), coordinatorThreadId: 'z' } })).rejects.toEqual(refusal('thread.coordinator.changed'))
    await expect(f.service.setForThread('x', true, { expect: { ...preview.token, teamRevision: f.revision(f.team), identity: 'id-other' } })).rejects.toEqual(refusal('thread.coordinator.changed'))
    expect(f.state()).toBe(before)
    expect(f.roles(f.team)).toMatchObject({ Ana: 'coordinator', Bia: 'developer' })
  })

  it('refuses when Git cannot tell the identity, or the project moves while it is resolved, with nothing written', async () => {
    const f = fixture()
    f.thread('n', 'p4'); f.thread('x')
    await expect(f.service.setForThread('n', true)).rejects.toEqual(refusal('thread.coordinator.identityUnavailable'))
    // An identity shared with unrelated folders is refused, and a guard Git does not answer is unavailable (SECURITY M-1).
    f.guard.mockResolvedValueOnce('ambiguous')
    await expect(f.service.setForThread('x', true)).rejects.toEqual(refusal('thread.coordinator.identityAmbiguous'))
    f.guard.mockRejectedValueOnce(Error('git timed out'))
    await expect(f.service.setForThread('x', true)).rejects.toEqual(refusal('thread.coordinator.identityUnavailable'))
    f.archive('x')
    await expect(f.service.setForThread('x', true)).rejects.toEqual(refusal('thread.coordinator.archived'))
    f.db.prepare("UPDATE conversation_threads SET data_json = json_set(data_json, '$.archived', json('false')) WHERE id = 'x'").run()
    f.identify.mockImplementationOnce(async () => { f.db.prepare("UPDATE thread_projects SET root_path = '/moved' WHERE id = 'p1'").run(); return 'id-repo' })
    await expect(f.service.setForThread('x', true)).rejects.toEqual(refusal('thread.coordinator.projectChanged'))
    expect(f.rows()).toEqual([])
  })
})

describe('rules from the Team (B1.4 · S7.5)', () => {
  async function teamed() {
    const f = fixture()
    for (const id of ['x', 'y', 'w']) f.thread(id)
    f.thread('o', 'p3')
    const team = f.team()
    f.link(f.member(team, 'Ana'), 'thread', 'y'); f.link(f.member(team, 'Bia'), 'thread', 'x'); f.link(f.member(team, 'Caio'), 'pane', 'pane-1')
    await f.service.setForThread('o', true) // another repository's coordinator, which no rule here may touch
    await reconcileProjectCoordinators(f.db, f.identify, f.guard)
    expect(f.rows()).toEqual([{ identity: 'id-other', threadId: 'o' }, { identity: 'id-repo', threadId: 'y' }])
    return { ...f, team }
  }

  it('rule 4: the Team making a connected member coordinator moves the row to its conversation, with the same swap', async () => {
    const f = await teamed()
    const before = f.state()
    const preview = await f.service.setMemberCoordinator(f.team, f.revision(f.team), f.member(f.team, 'Bia'), { preview: true })
    expect(f.state()).toBe(before)
    expect(preview).toMatchObject({ changed: ['y', 'x'], swap: { promoted: 'Bia', demoted: 'Ana', demotedRole: 'developer' }, previous: { threadId: 'y' } })
    const done = await f.service.setMemberCoordinator(f.team, f.revision(f.team), f.member(f.team, 'Bia'), { expect: preview.token })
    expect(done.changed).toEqual(['y', 'x'])
    expect(f.roles(f.team)).toEqual({ Ana: 'developer', Bia: 'coordinator', Caio: 'reviewer' })
    expect(f.rows()).toEqual([{ identity: 'id-other', threadId: 'o' }, { identity: 'id-repo', threadId: 'x' }])
    invariant(f.db)
  })

  it('rule 4: a coordinator on a pane is a label, so the previous coordinator\'s row goes and the other rows stay', async () => {
    const f = await teamed()
    const done = await f.service.setMemberCoordinator(f.team, f.revision(f.team), f.member(f.team, 'Caio'))
    expect(done.changed).toEqual(['y'])
    expect(f.roles(f.team)).toEqual({ Ana: 'reviewer', Bia: 'developer', Caio: 'coordinator' })
    expect(f.rows()).toEqual([{ identity: 'id-other', threadId: 'o' }])
    invariant(f.db)
    // A stale revision is refused before anything moves, as the Team always did.
    await expect(f.service.setMemberCoordinator(f.team, 1, f.member(f.team, 'Ana'))).rejects.toEqual(refusal('team.changed'))
  })

  it('TeamRepository.replaceCoordinator swaps too: one semantics for both paths', () => {
    const f = fixture()
    const team = f.team()
    f.teams.replaceCoordinator(team, f.revision(team), f.member(team, 'Caio'))
    expect(f.roles(team)).toEqual({ Ana: 'reviewer', Bia: 'developer', Caio: 'coordinator' })
  })

  it('connecting the coordinator to a conversation moves the row there, from another conversation or from a pane', async () => {
    const f = await teamed()
    const executions = new ExecutionRegistry()
    const access = new TeamAccess(f.db, executions, f.identify)
    for (const id of ['w', 'x']) executions.register({ owner: { kind: 'thread', id }, workspaceId: 'ws', cwd: '/repo' })
    const ana = f.member(f.team, 'Ana')
    const preview = await f.service.connectMember(access, f.team, f.revision(f.team), ana, { kind: 'thread', id: 'w' }, { preview: true })
    expect(preview).toMatchObject({ changed: ['y', 'w'], previous: { threadId: 'y' } })
    expect(f.rows()).toContainEqual({ identity: 'id-repo', threadId: 'y' })
    const done = await f.service.connectMember(access, f.team, f.revision(f.team), ana, { kind: 'thread', id: 'w' }, { expect: preview.token })
    expect(done.changed).toEqual(['y', 'w'])
    expect(f.rows()).toEqual([{ identity: 'id-other', threadId: 'o' }, { identity: 'id-repo', threadId: 'w' }])
    invariant(f.db)
    // From a pane, connected to a conversation for the first time.
    access.disconnectFromUi(f.team, f.revision(f.team), ana)
    f.link(ana, 'pane', 'pane-2')
    await f.service.setForThread('y', true) // the person's choice while the coordinator is on a pane
    expect(f.rows()).toContainEqual({ identity: 'id-repo', threadId: 'y' })
    await f.service.connectMember(access, f.team, f.revision(f.team), ana, { kind: 'thread', id: 'w' })
    expect(f.rows()).toContainEqual({ identity: 'id-repo', threadId: 'w' })
    invariant(f.db)
  })

  it('refuses the coordinator on a conversation of another repository, and a preview with no owner or no session, writing nothing (L1, L2)', async () => {
    const f = await teamed()
    const executions = new ExecutionRegistry()
    const access = new TeamAccess(f.db, executions, f.identify)
    executions.register({ owner: { kind: 'thread', id: 'o' }, workspaceId: 'ws', cwd: '/repo' }) // its session runs in this repository, its project is another
    const ana = f.member(f.team, 'Ana'), bia = f.member(f.team, 'Bia')
    const before = f.state()
    for (const preview of [true, false]) {
      await expect(f.service.connectMember(access, f.team, f.revision(f.team), ana, { kind: 'thread', id: 'o' }, { preview })).rejects.toEqual(refusal('thread.coordinator.otherProject'))
    }
    await expect(f.service.connectMember(access, f.team, f.revision(f.team), ana, undefined as never, { preview: true })).rejects.toThrow('Invalid session owner')
    await expect(f.service.connectMember(access, f.team, f.revision(f.team), ana, { kind: 'thread', id: 'w' }, { preview: true })).rejects.toThrow('Start the agent session')
    // A member that is not the coordinator connects to it as before; the coordinator role then refuses it too.
    f.link(bia, 'thread', 'o')
    await expect(f.service.setMemberCoordinator(f.team, f.revision(f.team), bia)).rejects.toEqual(refusal('thread.coordinator.otherProject'))
    f.link(bia, 'thread', 'x')
    expect(f.state()).toBe(before)
  })

  it('rule 5: disconnecting or archiving the coordinator member keeps the row, and then rule 2 no longer applies', async () => {
    const f = await teamed()
    const executions = new ExecutionRegistry()
    const access = new TeamAccess(f.db, executions, f.identify)
    const ana = f.member(f.team, 'Ana')
    const preview = f.service.teamChange(f.team, () => access.disconnectFromUi(f.team, f.revision(f.team), ana),
      () => f.db.prepare('DELETE FROM agent_team_execution_links WHERE member_id = ?').run(ana), { preview: true })
    expect(preview.changed).toEqual([])
    expect(f.db.prepare('SELECT 1 FROM agent_team_execution_links WHERE member_id = ?').get(ana)).toBeTruthy()
    f.service.teamChange(f.team, () => access.disconnectFromUi(f.team, f.revision(f.team), ana), () => {})
    expect(f.rows()).toContainEqual({ identity: 'id-repo', threadId: 'y' })
    expect(isThreadCoordinator(f.db, 'y')).toBe(true)
    invariant(f.db)
    await f.service.setForThread('w', true)
    expect(f.rows()).toContainEqual({ identity: 'id-repo', threadId: 'w' })
    // Archiving the member keeps the row too.
    f.link(ana, 'thread', 'w')
    f.service.teamChange(f.team, () => f.teams.archive(f.team, f.revision(f.team), ana), () => {})
    expect(f.rows()).toContainEqual({ identity: 'id-repo', threadId: 'w' })
    expect(isThreadCoordinator(f.db, 'w')).toBe(true)
    invariant(f.db)
  })
})

describe('the authority check (B1.4 · S7.5)', () => {
  it('grants nothing from a row the Team\'s precedence, an archive or a moved project contradicts', async () => {
    const f = fixture()
    f.thread('x'); f.thread('y')
    const team = f.team()
    await f.service.setForThread('y', true)
    expect(isThreadCoordinator(f.db, 'y')).toBe(true)
    // A missed write path: the Team coordinator is connected to x while the row says y.
    f.link(f.member(team, 'Ana'), 'thread', 'x')
    for (const granted of [isThreadCoordinator(f.db, 'y'), threadToolRoles(f.db, 'y').coordinator, threadActionRoles(f.db, 'y').has('coordinator'), coordinatorIds(f.db).has('y')]) expect(granted).toBe(false)
    expect(coordinatorPendingRequests(f.db, 'y')).toEqual({ items: [], total: 0 })
    f.db.prepare('DELETE FROM agent_team_execution_links').run()
    expect(isThreadCoordinator(f.db, 'y')).toBe(true)
    f.db.prepare("UPDATE thread_projects SET root_path = '/elsewhere' WHERE id = 'p1'").run()
    expect(isThreadCoordinator(f.db, 'y')).toBe(false)
    f.db.prepare("UPDATE thread_projects SET root_path = '/repo' WHERE id = 'p1'").run()
    f.archive('y')
    expect(isThreadCoordinator(f.db, 'y')).toBe(false)
  })

  it('the coordinator role adds its own group to a session, while orchestration follows the project\'s mode (M-2)', () => {
    const off = projectToolModes({ toolModes: { orchestration: 'off', app: 'off' } })
    const plain = sessionToolPlan(true, {}, off).tools, coordinator = sessionToolPlan(true, { coordinator: true }, off).tools
    expect(coordinator).toContain('oxespace_threads')
    expect(plain).not.toContain('oxespace_threads')
    for (const tools of [plain, coordinator]) expect(tools).not.toContain('oxespace_list_agents')
    // On demand without tool search, orchestration waits for oxespace_tools_enable, the coordinator's as anyone's.
    expect(sessionToolPlan(false, { coordinator: true }, projectToolModes(undefined)).enableable).toHaveProperty('orchestration')
    // With the role and orchestration `always`, each tool is offered once (L5).
    const always = sessionToolPlan(true, { coordinator: true, team: true, worker: true }, projectToolModes({ toolModes: { orchestration: 'always', app: 'always' } })).tools
    expect(always).toEqual(expect.arrayContaining(['oxespace_list_agents', 'oxespace_threads']))
    expect(always.length).toBe(new Set(always).size)
  })
})

describe('the boot pass and the backfill (B1.4 · S7.5)', () => {
  it('backfills each Team coordinator connected to an existing, unarchived conversation of its identity, and runs again safely', async () => {
    const f = fixture()
    f.thread('x'); f.thread('gone-soon'); f.thread('o', 'p3'); f.thread('archived', 'p3', { archived: true })
    const repo = f.team(), other = f.team('id-other'), third = f.team('id-third')
    f.link(f.member(repo, 'Ana'), 'thread', 'x')
    f.link(f.member(other, 'Ana'), 'thread', 'archived')
    f.link(f.member(third, 'Ana'), 'thread', 'o') // linked across repositories: o is id-other, not id-third
    f.link(f.member(repo, 'Bia'), 'thread', 'gone-soon')
    expect(await reconcileProjectCoordinators(f.db, f.identify, f.guard)).toEqual(['x'])
    expect(f.rows()).toEqual([{ identity: 'id-repo', threadId: 'x' }])
    f.db.prepare('DELETE FROM agent_team_execution_links WHERE member_id = ?').run(f.member(third, 'Ana')) // the helper cannot tell it is another repository
    invariant(f.db)
    expect(await reconcileProjectCoordinators(f.db, f.identify, f.guard)).toEqual([])
    expect(f.rows()).toEqual([{ identity: 'id-repo', threadId: 'x' }])
    // It recorded what it granted, once.
    expect(JSON.parse((f.db.prepare("SELECT value FROM thread_settings WHERE key = 'coordinator.backfill'").get() as { value: string }).value)).toMatchObject({ granted: ['x'] })
    // /archive removes the row; /resume un-archives the conversation, which is still connected to the coordinator: no role at the next boot.
    f.db.prepare("DELETE FROM project_coordinators WHERE thread_id = 'x'").run()
    f.archive('x')
    f.db.prepare("UPDATE conversation_threads SET data_json = json_set(data_json, '$.archived', json('false')) WHERE id = 'x'").run()
    expect(await reconcileProjectCoordinators(f.db, f.identify, f.guard)).toEqual([])
    expect(f.rows()).toEqual([])
  })

  it('backfills nothing from an ambiguous identity, and drops a row whose identity became ambiguous (M-1)', async () => {
    const f = fixture()
    f.thread('x'); f.thread('o', 'p3')
    await f.service.setForThread('o', true)
    const team = f.team()
    f.link(f.member(team, 'Ana'), 'thread', 'x')
    f.guard.mockImplementation(async root => root === '/repo' || root === '/other' ? 'ambiguous' : 'ok')
    expect(await reconcileProjectCoordinators(f.db, f.identify, f.guard)).toEqual(['o'])
    expect(f.rows()).toEqual([])
  })

  it('keeps a row the Team\'s precedence holds back when the coordinator\'s conversation is not of that identity (L-3)', async () => {
    const f = fixture()
    f.thread('y'); f.thread('x', 'p3')
    await f.service.setForThread('y', true)
    const team = f.team()
    // An old link: the coordinator is connected to x, whose project is another repository.
    f.link(f.member(team, 'Ana'), 'thread', 'x')
    expect(isThreadCoordinator(f.db, 'y')).toBe(false)
    await reconcileProjectCoordinators(f.db, f.identify, f.guard)
    expect(f.rows()).toEqual([{ identity: 'id-repo', threadId: 'y' }])
    // Once x really is of this identity, the precedence takes the row away.
    f.db.prepare("UPDATE conversation_threads SET thread_project_id = 'p1' WHERE id = 'x'").run()
    await reconcileProjectCoordinators(f.db, f.identify, f.guard)
    expect(f.rows()).toEqual([])
  })

  it('drops drifted rows, keeps a row when Git cannot answer, and never backfills from a failed probe', async () => {
    const f = fixture()
    f.thread('x'); f.thread('o', 'p3'); f.thread('a', 'p2')
    await f.service.setForThread('x', true)
    await f.service.setForThread('o', true)
    // Git fails for /other: the row stays.
    f.identities.delete('/other')
    expect(await reconcileProjectCoordinators(f.db, f.identify, f.guard)).toEqual([])
    expect(f.rows()).toHaveLength(2)
    // The root now resolves to another identity (a re-clone): the row goes.
    f.identities.set('/repo', 'id-reclone')
    expect(await reconcileProjectCoordinators(f.db, f.identify, f.guard)).toEqual(['x'])
    // An archived conversation's row goes; nothing is backfilled from a probe that fails.
    f.archive('o')
    const team = f.team('id-other')
    f.link(f.member(team, 'Ana'), 'thread', 'a')
    expect(await reconcileProjectCoordinators(f.db, f.identify, f.guard)).toEqual([])
    expect(f.rows()).toEqual([])
  })
})

describe('project relink keeps the coordinator (B1.4 · S7.5)', () => {
  it('re-keys the row to the new root and identity, or removes it when that identity already has a coordinator', async () => {
    const base = mkdtempSync(join(tmpdir(), 'oxe-relink-'))
    cleanup.push(() => { try { rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* Windows may still hold a Git file */ } })
    const [gone, moved, taken] = ['gone', 'moved', 'taken'].map(name => { const path = join(base, name); mkdirSync(path); execFileSync('git', ['init', '-q', path]); return path })
    const f = fixture()
    const identity = async (root: string) => projectIdentity(root)
    const service = new ProjectCoordinatorService(f.db, identity)
    for (const [id, root] of [['pg', gone], ['pt', taken]]) f.db.prepare('INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)').run(id, await projectIdentity(root), root, id)
    f.thread('q', 'pg', { rootPath: gone }); f.thread('r', 'pt', { rootPath: taken })
    await service.setForThread('q', true)
    rmSync(gone, { recursive: true, force: true })
    const heard: string[][] = []
    const projects = new ThreadProjectService(f.db, ids => heard.push(ids))
    await projects.relink('pg', moved)
    const canonical = (f.db.prepare("SELECT root_path FROM thread_projects WHERE id = 'pg'").get() as { root_path: string }).root_path
    expect(f.db.prepare('SELECT project_identity AS identity, root_path AS root FROM project_coordinators WHERE thread_id = ?').get('q')).toEqual({ identity: await projectIdentity(moved), root: canonical })
    expect(isThreadCoordinator(f.db, 'q')).toBe(true)
    expect(heard).toEqual([])
    // Relinked onto a folder whose identity already has a coordinator (a legacy duplicate project): this project's row goes.
    await service.setForThread('r', true)
    f.db.prepare("UPDATE thread_projects SET identity = 'legacy:pt' WHERE id = 'pt'").run()
    rmSync(moved, { recursive: true, force: true })
    await projects.relink('pg', taken)
    expect(heard).toEqual([['q']])
    expect(f.db.prepare('SELECT 1 FROM project_coordinators WHERE thread_id = ?').get('q')).toBeUndefined()
    expect(isThreadCoordinator(f.db, 'r')).toBe(true)
  }, 30_000)
})
