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
