// @vitest-environment node
// Frozen acceptance test for OXE-446 (A3): ci-failed event trigger deduplication by (automationId, eventKey),
// global maxConcurrent cap with FIFO overflow queueing, and per-run timeout cancelling via interrupt() -> timed_out.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { EventTriggerDispatcher } from '../../../electron/main/services/schedules/event-triggers'
import { ScheduleStore } from '../../../electron/main/services/schedules/schedule-store'
import { Scheduler } from '../../../electron/main/services/schedules/scheduler'

const openDbs: AppDatabase[] = []
afterEach(() => {
  vi.useRealTimers()
  for (const db of openDbs.splice(0)) db.close()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('OXE-446 A3 · event trigger deduplication, global concurrency cap, and per-run timeout', () => {
  it('fires ci-failed event trigger exactly once per deduplicated (scheduleId, eventKey)', async () => {
    const db = openInMemoryDatabase(); openDbs.push(db)
    const store = new ScheduleStore(db)
    const start = vi.fn(async () => ({ threadId: `t-${start.mock.calls.length + 1}` }))
    const scheduler = new Scheduler({
      store,
      start,
      busy: async () => false,
      knownProject: () => true
    })

    const ciAutomation = scheduler.save({
      name: 'CI Triage',
      projectId: 'p1',
      rootPath: 'C:/work/repo',
      provider: 'claude',
      access: 'read-only',
      prompt: 'Inspect failed CI run.',
      rule: { kind: 'event', eventType: 'ci-failed', branchFilter: 'main' }
    })

    const dispatcher = new EventTriggerDispatcher({
      store,
      scheduler,
      provider: {
        listWorkflowRuns: async () => [
          { databaseId: 5001, status: 'completed', conclusion: 'failure', branch: 'main', displayTitle: 'CI #5001', url: 'https://github.com/org/repo/actions/runs/5001' },
          { databaseId: 5002, status: 'completed', conclusion: 'success', branch: 'main', displayTitle: 'CI #5002', url: null },
          { databaseId: 5003, status: 'completed', conclusion: 'failure', branch: 'feat/other', displayTitle: 'CI #5003', url: null }
        ]
      }
    })

    const firstPoll = await dispatcher.pollOnce()
    expect(firstPoll.filter(item => item.accepted)).toHaveLength(1)
    expect(start).toHaveBeenCalledTimes(1)
    expect(scheduler.runs(ciAutomation.id)[0].eventKey).toBe('ci-failed:5001')

    // Polling the exact same failed workflow run again MUST deduplicate and NOT fire again.
    const secondPoll = await dispatcher.pollOnce()
    expect(secondPoll.filter(item => item.accepted)).toHaveLength(0)
    expect(secondPoll.some(item => item.scheduleId === ciAutomation.id && item.reason === 'duplicate')).toBe(true)
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('enforces global maxConcurrent cap by queueing overflow runs FIFO and draining as active runs finish', async () => {
    const db = openInMemoryDatabase(); openDbs.push(db)
    const store = new ScheduleStore(db)
    let activeNow = 0
    let maxObserved = 0
    const gates: Array<ReturnType<typeof deferred<{ status: 'completed' }>>> = []
    let seq = 0

    const scheduler = new Scheduler({
      store,
      lifecycle: 'managed',
      start: async () => {
        activeNow += 1
        maxObserved = Math.max(maxObserved, activeNow)
        const gate = deferred<{ status: 'completed' }>()
        gates.push(gate)
        const threadId = `thread-conc-${++seq}`
        return {
          threadId,
          waitForCompletion: gate.promise.finally(() => { activeNow -= 1 })
        }
      },
      busy: async () => false,
      knownProject: () => true
    })

    expect(scheduler.state().maxConcurrent).toBe(2)

    const automations = [1, 2, 3, 4].map(index => scheduler.save({
      name: `Job ${index}`,
      projectId: 'p1',
      rootPath: 'C:/work/repo',
      provider: 'claude',
      access: 'read-only',
      prompt: `Run job ${index}`,
      rule: { kind: 'event', eventType: 'manual-cli' }
    }))

    const runs = await Promise.all(automations.map(item => scheduler.triggerEventRun(item.id, { eventKey: `cli:${item.id}` })))
    expect(runs.filter(r => r.outcome === 'running')).toHaveLength(2)
    expect(runs.filter(r => r.outcome === 'queued')).toHaveLength(2)
    expect(maxObserved).toBe(2)

    // Complete first two active runs -> queued runs 3 & 4 must drain automatically.
    gates[0].resolve({ status: 'completed' })
    gates[1].resolve({ status: 'completed' })
    await vi.waitFor(() => expect(gates.length).toBe(4))
    expect(maxObserved).toBe(2)

    gates[2].resolve({ status: 'completed' })
    gates[3].resolve({ status: 'completed' })
    await scheduler.waitForIdle()

    for (const run of runs) {
      expect(store.getRun(run.id)?.outcome).toBe('needs_review')
    }
  })

  it('cancels timed-out runs via interrupt(), records timed_out, frees slot, and emits notification', async () => {
    vi.useFakeTimers()
    const db = openInMemoryDatabase(); openDbs.push(db)
    const store = new ScheduleStore(db)
    const interrupt = vi.fn(async () => undefined)
    const notifications: Array<{ kind: string; runId: string }> = []
    const neverFinish = deferred<{ status: 'completed' }>()

    const scheduler = new Scheduler({
      store,
      lifecycle: 'managed',
      start: async () => ({ threadId: 'thread-timeout-1', waitForCompletion: neverFinish.promise }),
      interrupt,
      busy: async () => true,
      knownProject: () => true,
      notify: (payload) => { notifications.push({ kind: payload.kind, runId: payload.runId }); return true }
    })

    const saved = scheduler.save({
      name: 'Slow Audit',
      projectId: 'p1',
      rootPath: 'C:/work/repo',
      provider: 'claude',
      access: 'read-only',
      prompt: 'Hang forever.',
      timeoutMs: 1_500,
      rule: { kind: 'event', eventType: 'manual-cli' }
    })

    const run = await scheduler.runNow(saved.id)
    expect(run.outcome).toBe('running')

    await vi.advanceTimersByTimeAsync(1_600)
    await scheduler.waitForIdle()

    expect(interrupt).toHaveBeenCalledWith('thread-timeout-1')
    const persisted = store.getRun(run.id)
    expect(persisted?.outcome).toBe('timed_out')
    expect(persisted?.errorCode).toBe('TIMEOUT')
    expect(persisted?.finishedAt).toBeTypeOf('number')
    expect(notifications).toContainEqual({ kind: 'timed_out', runId: run.id })
  })
})
