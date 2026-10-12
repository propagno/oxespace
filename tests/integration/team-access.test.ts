import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ExecutionRegistry } from '../../electron/main/services/execution-registry'
import { TeamAccess } from '../../electron/main/services/coordination/team-access'
import { TEAM_TOOLS } from '../../electron/main/mcp-internal/team-tools'
import type { ToolContext } from '../../electron/main/mcp-internal/tool-registry'

const databases: AppDatabase[] = []
afterEach(() => databases.splice(0).forEach(db => db.close()))
function fixture() {
  const db = openInMemoryDatabase(); databases.push(db)
  const executions = new ExecutionRegistry(), access = new TeamAccess(db, executions, async () => '/git')
  let team = access.repository.ensure('/git', 'Team')
  team = access.repository.add(team.id, team.revision, 'Coordinator', 'coordinator')
  team = access.repository.add(team.id, team.revision, 'Developer', 'developer')
  const owner = { kind: 'pane' as const, id: 'pane' }
  executions.register({ owner, workspaceId: 'workspace', cwd: '/repo' })
  const actor = executions.forOwner(owner)!
  const coordinator = team.members.find(m => m.role === 'coordinator')!, developer = team.members.find(m => m.role === 'developer')!
  return { db, executions, access, team, owner, actor, coordinator, developer }
}
describe('team execution authorization', () => {
  it('requires fresh Thread delivery consent and rejects Claude read-only and Code delivery', async () => {
    const f = fixture()
    await f.access.connectFromUi(f.team.id, f.team.revision, f.coordinator.id, f.owner)
    const revision = () => f.access.repository.get(f.team.id).revision
    expect(() => f.access.setDeliveryFromUi(f.team.id, revision(), f.coordinator.id, true)).toThrow('connected Thread')
    f.access.disconnectFromUi(f.team.id, revision(), f.coordinator.id)
    const owner = { kind: 'thread' as const, id: 'thread-delivery' }
    f.executions.register({ owner, workspaceId: 'workspace', cwd: '/repo' })
    await f.access.connectFromUi(f.team.id, revision(), f.coordinator.id, owner)
    f.db.prepare('INSERT INTO thread_projects (id,identity,root_path,display_name,created_at,updated_at) VALUES (?,?,?,?,1,1)').run('project', '/git', '/repo', 'Project')
    f.db.prepare('INSERT INTO conversation_threads (id,workspace_id,thread_project_id,data_json,events_json) VALUES (?,?,?,?,?)')
      .run(owner.id, 'workspace', 'project', JSON.stringify({ provider: 'claude', access: 'read-only' }), '[]')
    expect(() => f.access.setDeliveryFromUi(f.team.id, revision(), f.coordinator.id, true)).toThrow('read-only disables MCP')
    f.db.prepare('UPDATE conversation_threads SET data_json=? WHERE id=?').run(JSON.stringify({ provider: 'claude', access: 'workspace-write' }), owner.id)
    f.access.setDeliveryFromUi(f.team.id, revision(), f.coordinator.id, true)
    expect(f.access.deliveryTargets()).toEqual([{ teamId: f.team.id, memberId: f.coordinator.id, threadId: owner.id }])
    expect(new TeamAccess(f.db, f.executions, async () => '/git').deliveryTargets()).toEqual([])
    f.executions.register({ owner, workspaceId: 'workspace', cwd: '/repo' })
    expect(f.access.deliveryTargets()).toEqual([])
    expect(() => f.access.setDeliveryFromUi(f.team.id, revision(), f.coordinator.id, true)).toThrow('connected Thread')
  })
  it('requires explicit connection, rejects stale credentials and never restores authorization from a saved surface', async () => {
    const f = fixture()
    await expect(f.access.authorize(f.actor)).rejects.toThrow('Connect this session')
    await f.access.connectFromUi(f.team.id, f.team.revision, f.coordinator.id, f.owner)
    expect((await f.access.authorize(f.actor)).member.id).toBe(f.coordinator.id)
    const reopened = new TeamAccess(f.db, f.executions, async () => '/git')
    await expect(reopened.authorize(f.actor)).rejects.toThrow('Connect this session')
    expect(reopened.snapshotFromUi(f.team.id).members.find(m => m.id === f.coordinator.id)?.connection?.state).toBe('disconnected')
    f.executions.register({ owner: f.owner, workspaceId: 'workspace', cwd: '/repo' })
    await expect(f.access.authorize(f.actor)).rejects.toThrow()
    await expect(f.access.authorize(f.executions.forOwner(f.owner)!)).rejects.toThrow('Connect this session')
  })
  it('does not allow another project, duplicate connections or revoked membership', async () => {
    const f = fixture()
    const other = new TeamAccess(f.db, f.executions, async () => '/other')
    await expect(other.connectFromUi(f.team.id, f.team.revision, f.coordinator.id, f.owner)).rejects.toThrow('does not belong')
    await f.access.connectFromUi(f.team.id, f.team.revision, f.coordinator.id, f.owner)
    let team = f.access.repository.get(f.team.id)
    await expect(f.access.connectFromUi(team.id, team.revision, f.developer.id, f.owner)).rejects.toThrow()
    team = f.access.repository.archive(team.id, team.revision, f.coordinator.id)
    await expect(f.access.authorize(f.actor)).rejects.toThrow('Connect this session')
    expect(team.members.find(m => m.id === f.coordinator.id)?.archived).toBe(true)
  })
  it('rechecks identity and live execution after an asynchronous identity lookup', async () => {
    const f = fixture()
    const access = new TeamAccess(f.db, f.executions, async () => { f.executions.endOwner(f.owner); return '/git' })
    await expect(access.connectFromUi(f.team.id, f.team.revision, f.coordinator.id, f.owner)).rejects.toThrow()
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM agent_team_execution_links').get()).toEqual({ n: 0 })
  })
  it('derives MCP sender from authentication and rejects impersonation arguments', async () => {
    const f = fixture()
    await f.access.connectFromUi(f.team.id, f.team.revision, f.coordinator.id, f.owner)
    const context = { team: f.access, executions: f.executions, executionId: f.actor.id, executionToken: f.actor.token, workspaceId: f.actor.workspaceId } as ToolContext
    const tool = TEAM_TOOLS.find(t => t.descriptor.name === 'oxespace_team_message')!
    const args = { recipientId: f.developer.id, key: 'task-1', kind: 'request', body: 'Please review' }
    await expect(tool.handler({ ...args, senderId: f.developer.id }, context)).rejects.toThrow('Unknown team argument')
    await tool.handler(args, context)
    const inbox = f.access.repository.inbox(f.team.id, f.developer.id)
    expect(inbox).toHaveLength(1)
    expect(inbox[0]).toMatchObject({ senderId: f.coordinator.id, receivedAt: null })
    f.access.disconnectFromUi(f.team.id, f.access.repository.get(f.team.id).revision, f.coordinator.id)
    await expect(tool.handler(args, context)).rejects.toThrow('Connect this session')
  })
})
