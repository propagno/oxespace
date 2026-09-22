import { describe, expect, it } from 'vitest'
import { ThreadSessionSupervisor } from '../electron/main/services/conversation/thread-session-supervisor'

describe('ThreadSessionSupervisor', () => {
  it('tracks connect, heartbeat and close without inventing provider work', () => {
    const supervisor = new ThreadSessionSupervisor()
    expect(supervisor.begin('thread', 10)).toMatchObject({ state: 'starting', attempt: 1 })
    expect(supervisor.connected('thread', 20)).toMatchObject({ state: 'connected', attempt: 0, lastHeartbeatAt: 20 })
    expect(supervisor.heartbeat('thread', 30)).toMatchObject({ state: 'connected', lastHeartbeatAt: 30 })
    expect(supervisor.close('thread', 40)).toMatchObject({ state: 'closed', attempt: 0 })
  })

  it('backs off repeated failures and opens the circuit after five attempts', () => {
    const supervisor = new ThreadSessionSupervisor()
    for (let attempt = 1; attempt <= 5; attempt++) {
      supervisor.begin('thread', attempt * 100)
      const failure = supervisor.failed('thread', `failure ${attempt}`, attempt * 100 + 1)
      expect(failure.attempt).toBe(attempt)
    }
    expect(supervisor.canAttempt('thread', 1_000)).toBe(false)
    expect(supervisor.canAttempt('thread', supervisor.get('thread')!.nextRetryAt)).toBe(true)
  })

  it('applies stable bounded jitter so concurrent threads do not reconnect together', () => {
    const first = new ThreadSessionSupervisor(), second = new ThreadSessionSupervisor()
    first.begin('thread-a', 0); second.begin('thread-b', 0)
    const a = first.failed('thread-a', 'offline', 1).nextRetryAt!
    const b = second.failed('thread-b', 'offline', 1).nextRetryAt!
    expect(a).toBeGreaterThanOrEqual(851)
    expect(a).toBeLessThanOrEqual(1_151)
    expect(a).not.toBe(b)
  })
})
