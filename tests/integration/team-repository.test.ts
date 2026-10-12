import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { TeamRepository } from '../../electron/main/services/coordination/team-repository'

const databases: AppDatabase[] = []
afterEach(() => databases.splice(0).forEach(db => db.close()))
function fixture() {
  const db = openInMemoryDatabase(); databases.push(db)
  const repo = new TeamRepository(db, () => 100)
  let team = repo.ensure('/canonical/git', 'Product')
  team = repo.add(team.id, team.revision, 'Coordinator', 'coordinator')
  team = repo.add(team.id, team.revision, 'Developer', 'developer')
  const coordinator = team.members.find(m => m.role === 'coordinator')!, developer = team.members.find(m => m.role === 'developer')!
  return { db, repo, team, coordinator, developer }
}
describe('persistent team foundation', () => {
  it('retains identity across repository instances without creating Code or Thread resources', () => {
    const f = fixture(), reopened = new TeamRepository(f.db)
    expect(reopened.ensure('/canonical/git', 'Renamed elsewhere')).toEqual(f.team)
    for (const table of ['workspaces', 'conversation_threads', 'thread_projects']) {
      expect(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 })
    }
  })
  it('replaces a coordinator atomically and rejects stale edits without losing members', () => {
    const f = fixture()
    const updated = f.repo.replaceCoordinator(f.team.id, f.team.revision, f.developer.id)
    expect(updated.members.find(m => m.id === f.developer.id)?.role).toBe('coordinator')
    expect(updated.members.find(m => m.id === f.coordinator.id)?.role).toBe('developer')
    expect(() => f.repo.archive(f.team.id, f.team.revision, f.developer.id)).toThrow('Team changed')
    expect(() => f.repo.add(f.team.id, updated.revision, 'Duplicate', 'coordinator')).toThrow()
    expect(f.repo.get(f.team.id)).toEqual(updated)
  })
  it('rejects duplicate native ownership and stale generations without partial edits', () => {
    const f = fixture()
    const binding = { memberId: f.coordinator.id, provider: 'codex' as const, nativeSessionId: 'native', canonicalRoot: '/repo', surface: 'thread' as const, surfaceId: 'thread-A', generation: 1 }
    const updated = f.repo.bind(f.team.id, f.team.revision, binding)
    expect(() => f.repo.bind(f.team.id, updated.revision, { ...binding, memberId: f.developer.id, surfaceId: 'thread-B' })).toThrow()
    expect(() => f.repo.bind(f.team.id, updated.revision, binding)).toThrow('generation')
    expect(f.repo.get(f.team.id).revision).toBe(updated.revision)
    expect(new TeamRepository(f.db).binding(f.coordinator.id)).toEqual(binding)
  })
  it('deduplicates retries, keeps receipt separate from reads and checks recipient ownership', () => {
    const f = fixture(), request = { teamId: f.team.id, senderId: f.coordinator.id, recipientId: f.developer.id, key: 'request-1', kind: 'request' as const, body: 'Implement authentication' }
    const message = f.repo.send(request)
    expect(new TeamRepository(f.db).send(request)).toEqual(message)
    expect(() => f.repo.send({ ...request, body: 'Different task' })).toThrow('different content')
    expect(f.repo.inbox(f.team.id, f.developer.id)[0].receivedAt).toBeNull()
    expect(() => f.repo.acknowledge(f.team.id, f.coordinator.id, message.id)).toThrow('recipient')
    f.repo.acknowledge(f.team.id, f.developer.id, message.id)
    expect(f.repo.inbox(f.team.id, f.developer.id)[0].receivedAt).toBe(100)
    const reply = f.repo.send({ ...request, key: 'reply', senderId: f.developer.id, recipientId: f.coordinator.id, kind: 'answer', body: 'Accepted', replyTo: message.id })
    expect(f.repo.inbox(f.team.id, f.coordinator.id)).toEqual([reply])
    expect(f.repo.inbox(f.team.id, f.developer.id, message.sequence)).toEqual([])
  })
  it('isolates teams and preserves messages when archiving a member', () => {
    const f = fixture()
    let other = f.repo.ensure('/another/git', 'Other')
    other = f.repo.add(other.id, other.revision, 'Other member', 'developer')
    expect(() => f.repo.send({ teamId: f.team.id, senderId: f.coordinator.id, recipientId: other.members[0].id, key: 'cross', kind: 'request', body: 'No' })).toThrow('member')
    f.repo.send({ teamId: f.team.id, senderId: null, recipientId: f.developer.id, key: 'human', kind: 'request', body: 'Keep this' })
    const archived = f.repo.archive(f.team.id, f.team.revision, f.developer.id)
    expect(archived.members.find(m => m.id === f.developer.id)?.archived).toBe(true)
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM agent_team_messages').get()).toEqual({ n: 1 })
    expect(() => f.repo.inbox(f.team.id, f.developer.id)).toThrow('member')
  })
})
