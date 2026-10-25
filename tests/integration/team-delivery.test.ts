import { expect, it, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db'
import { TeamRepository } from '../../electron/main/services/coordination/team-repository'
import { TeamDelivery } from '../../electron/main/services/coordination/team-delivery'
import type { ThreadSnapshot } from '../../shared/types/thread'

it('waits for idle, submits once, and never confuses submission with recipient acknowledgement', async () => {
  const db = openInMemoryDatabase(), repository = new TeamRepository(db)
  try {
    let team = repository.ensure('project', 'Project')
    team = repository.add(team.id, team.revision, 'Coordinator', 'coordinator')
    const member = team.members[0]
    const message = repository.send({ teamId: team.id, senderId: null, recipientId: member.id, key: 'one', kind: 'result', body: 'Result A' })
    const target = { teamId: team.id, memberId: member.id, threadId: 'thread' }
    const access = { deliveryTargets: () => [target], disableDelivery: vi.fn() }
    const snapshot = { thread: { status: 'running', connection: { state: 'connected' } }, events: [] } as unknown as ThreadSnapshot
    const threads = { read: () => snapshot, send: vi.fn(async () => {}) }
    const delivery = new TeamDelivery(db, access, threads)
    await delivery.tick(); expect(threads.send).not.toHaveBeenCalled()
    snapshot.thread.status = 'idle'
    await delivery.tick(); await delivery.tick()
    expect(threads.send).toHaveBeenCalledTimes(1)
    expect(repository.inbox(team.id, member.id)[0]).toMatchObject({ id: message.id, receivedAt: null, deliveryState: 'submitted' })
    repository.acknowledge(team.id, member.id, message.id)
    expect(repository.inbox(team.id, member.id)[0].receivedAt).toBeTypeOf('number')
    repository.send({ teamId: team.id, senderId: null, recipientId: member.id, key: 'two', kind: 'result', body: 'Result B' })
    threads.send.mockRejectedValueOnce(Error('Connection dropped'))
    await delivery.tick()
    expect(access.disableDelivery).toHaveBeenCalledWith(member.id)
    const restarted = new TeamDelivery(db, access, threads)
    await restarted.tick()
    expect(threads.send).toHaveBeenCalledTimes(2)
    expect(repository.inbox(team.id, member.id)[1].deliveryState).toBe('unknown')
    snapshot.thread.status = 'interrupted'
    await restarted.tick()
    expect(access.disableDelivery).toHaveBeenCalledTimes(2)
  } finally { db.close() }
})

it('delivers to a member whose conversation was suspended while idle, which the send starts again', async () => {
  const db = openInMemoryDatabase(), repository = new TeamRepository(db)
  try {
    let team = repository.ensure('project', 'Project')
    team = repository.add(team.id, team.revision, 'Developer', 'developer')
    const member = team.members[0]
    repository.send({ teamId: team.id, senderId: null, recipientId: member.id, key: 'one', kind: 'request', body: 'Review the change' })
    const access = { deliveryTargets: () => [{ teamId: team.id, memberId: member.id, threadId: 'thread' }], disableDelivery: vi.fn() }
    const snapshot = { thread: { status: 'idle', connection: { state: 'disconnected', suspendedAt: 1 } }, events: [] } as unknown as ThreadSnapshot
    const threads = { read: () => snapshot, send: vi.fn(async () => {}) }
    await new TeamDelivery(db, access, threads).tick()
    expect(threads.send).toHaveBeenCalledWith('thread', expect.stringContaining('Review the change'))
    expect(access.disableDelivery).not.toHaveBeenCalled()
    // A connection that dropped for another reason is left alone.
    repository.send({ teamId: team.id, senderId: null, recipientId: member.id, key: 'two', kind: 'request', body: 'Second' })
    snapshot.thread.connection = { state: 'disconnected' } as never
    await new TeamDelivery(db, access, threads).tick()
    expect(threads.send).toHaveBeenCalledTimes(1)
  } finally { db.close() }
})

it('delivers every pending message in one turn, and marks them all when the send fails', async () => {
  const db = openInMemoryDatabase(), repository = new TeamRepository(db)
  try {
    let team = repository.ensure('project', 'Project')
    team = repository.add(team.id, team.revision, 'Developer', 'developer')
    const member = team.members[0]
    for (const key of ['one', 'two', 'three']) repository.send({ teamId: team.id, senderId: null, recipientId: member.id, key, kind: 'request', body: `Task ${key}` })
    const access = { deliveryTargets: () => [{ teamId: team.id, memberId: member.id, threadId: 'thread' }], disableDelivery: vi.fn() }
    const snapshot = { thread: { status: 'idle', connection: { state: 'connected' } }, events: [] } as unknown as ThreadSnapshot
    const threads = { read: () => snapshot, send: vi.fn(async () => {}) }
    await new TeamDelivery(db, access, threads).tick()
    expect(threads.send).toHaveBeenCalledTimes(1)
    const text = (threads.send.mock.calls[0] as unknown as [string, string])[1]
    expect(text).toContain('Task one'); expect(text).toContain('Task two'); expect(text).toContain('Task three')
    expect(text).toContain('These are 3 messages')
    expect(repository.inbox(team.id, member.id).map(message => message.deliveryState)).toEqual(['submitted', 'submitted', 'submitted'])
    for (const key of ['four', 'five']) repository.send({ teamId: team.id, senderId: null, recipientId: member.id, key, kind: 'request', body: `Task ${key}` })
    threads.send.mockRejectedValueOnce(Error('Connection dropped'))
    await new TeamDelivery(db, access, threads).tick()
    expect(repository.inbox(team.id, member.id).slice(3).map(message => message.deliveryState)).toEqual(['unknown', 'unknown'])
  } finally { db.close() }
})
