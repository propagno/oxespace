// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db/index'
import { ScheduleStore } from '../../electron/main/services/schedules/schedule-store'
import { ScheduleRefused, Scheduler } from '../../electron/main/services/schedules/scheduler'
import { scheduleThreadRunner } from '../../electron/main/services/schedules/thread-runner'
import { SCHEDULE_LIMITS, type ScheduleInput } from '../../shared/schedule'

const HOUR = 3_600_000
const START = new Date(2026, 10, 12, 8, 0).getTime()
const open: AppDatabase[] = []
afterEach(() => { for (const db of open.splice(0)) db.close() })

const daily = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({ name: 'Morning review', projectId: 'p1', rootPath: 'C:/work/shop', provider: 'claude', access: 'read-only', prompt: 'Review what changed.', rule: { kind: 'daily', time: '09:00', days: [0, 1, 2, 3, 4, 5, 6] }, ...over })

function setup(options: { start?: () => Promise<{ threadId: string }>; busy?: (threadId: string) => boolean; knownProject?: boolean } = {}) {
  const db = openInMemoryDatabase(); open.push(db)
  let now = START
  let threads = 0
  const start = vi.fn(options.start ?? (async () => ({ threadId: `thread-${++threads}` })))
  const changed = vi.fn()
  const scheduler = new Scheduler({ store: new ScheduleStore(db), start, busy: async threadId => options.busy?.(threadId) ?? false, knownProject: () => options.knownProject ?? true, changed, now: () => now })
  return { db, scheduler, start, changed, at: (time: number) => { now = time }, forward: (ms: number) => { now += ms }, one: () => scheduler.state().schedules[0] }
}

describe('schedules: what is saved', () => {
  test('a schedule is saved with when it is next due, and comes back after the database is read again', () => {
    const { scheduler, one, db } = setup()
    const saved = scheduler.save(daily())
    expect(saved).toMatchObject({ name: 'Morning review', enabled: true, catchUp: false, failures: 0, pausedReason: null, nextRunAt: new Date(2026, 10, 12, 9, 0).getTime(), lastRunAt: null })
    expect(new ScheduleStore(db).list()).toEqual([one()])
    expect(scheduler.state().paused).toBe(false)
  })

  test('what may not be saved is refused with its reason, and nothing is written', () => {
    const { scheduler } = setup()
    const refusal = (run: () => unknown): string => { try { run(); return 'saved' } catch (cause) { return cause instanceof ScheduleRefused ? cause.code : String(cause) } }
    expect(refusal(() => scheduler.save(daily({ access: 'workspace-write' })))).toBe('unconfirmedWrite')
    expect(refusal(() => scheduler.save(daily({ access: 'full-access' as never, confirmedWrite: true })))).toBe('access')
    expect(refusal(() => scheduler.save(daily({ rule: { kind: 'hours', every: 0.25, anchor: START } })))).toBe('every')
    expect(refusal(() => scheduler.save(daily({ id: 'no-such-schedule' })))).toBe('unknown')
    expect(refusal(() => setup({ knownProject: false }).scheduler.save(daily()))).toBe('project')
    expect(scheduler.state().schedules).toEqual([])
  })

  test('there is a limit to how many schedules there may be', () => {
    const { scheduler } = setup()
    for (let index = 0; index < SCHEDULE_LIMITS.count; index++) scheduler.save(daily({ name: `Schedule ${index}` }))
    expect(() => scheduler.save(daily({ name: 'One more' }))).toThrow(ScheduleRefused)
    expect(scheduler.state().schedules).toHaveLength(SCHEDULE_LIMITS.count)
  })

  test('changing a schedule keeps its id and its history; removing it removes both', async () => {
    const { scheduler, one, at } = setup()
    const saved = scheduler.save(daily())
    at(saved.nextRunAt!)
    await scheduler.tick()
    const changed = scheduler.save({ ...daily({ name: 'Evening review', rule: { kind: 'daily', time: '18:00', days: [1] } }), id: saved.id })
    expect(changed.id).toBe(saved.id)
    expect(one().name).toBe('Evening review')
    expect(scheduler.runs(saved.id)).toHaveLength(1)
    scheduler.remove(saved.id)
    expect(scheduler.state().schedules).toEqual([])
    expect(scheduler.runs(saved.id)).toEqual([])
  })
})

describe('schedules: what happens at the time', () => {
  test('before its time nothing runs; at its time it runs once, and the next time is tomorrow', async () => {
    const { scheduler, start, one, at, forward, changed } = setup()
    const saved = scheduler.save(daily())
    await scheduler.tick()
    expect(start).not.toHaveBeenCalled()
    at(saved.nextRunAt! + 20_000)
    await scheduler.tick()
    await scheduler.tick()
    expect(start).toHaveBeenCalledTimes(1)
    expect(start.mock.calls[0][0]).toMatchObject({ id: saved.id, prompt: 'Review what changed.', access: 'read-only' })
    expect(one()).toMatchObject({ nextRunAt: new Date(2026, 10, 13, 9, 0).getTime(), lastRunAt: saved.nextRunAt! + 20_000, failures: 0 })
    expect(scheduler.runs(saved.id)).toMatchObject([{ outcome: 'started', threadId: 'thread-1', dueAt: saved.nextRunAt }])
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ run: expect.objectContaining({ outcome: 'started' }) }))
    forward(60_000)
    await scheduler.tick()
    expect(start).toHaveBeenCalledTimes(1)
  })

  test('the app was closed for days: one "missed" in the history, not one per day, and nothing runs', async () => {
    const { scheduler, start, one, at } = setup()
    const saved = scheduler.save(daily())
    at(new Date(2026, 10, 16, 14, 0).getTime())
    await scheduler.tick()
    expect(start).not.toHaveBeenCalled()
    expect(scheduler.runs(saved.id).map(run => run.outcome)).toEqual(['missed'])
    expect(one().nextRunAt).toBe(new Date(2026, 10, 17, 9, 0).getTime())
  })

  test('"run when the app opens": one recovery, however many times it was due', async () => {
    const { scheduler, start, one, at } = setup()
    const saved = scheduler.save(daily({ catchUp: true, rule: { kind: 'hours', every: 1, anchor: START + HOUR } }))
    at(START + 30 * HOUR + 600_000)
    await scheduler.tick()
    await scheduler.tick()
    expect(start).toHaveBeenCalledTimes(1)
    expect(scheduler.runs(saved.id).map(run => run.outcome)).toEqual(['started'])
    expect(one().nextRunAt).toBe(START + 31 * HOUR)
  })

  test('the run before it is still at work or waiting for an answer: this one is skipped, with the reason', async () => {
    let working = true
    const { scheduler, start, at } = setup({ busy: () => working })
    const saved = scheduler.save(daily({ rule: { kind: 'hours', every: 1, anchor: START + HOUR } }))
    at(START + HOUR)
    await scheduler.tick()
    at(START + 2 * HOUR)
    await scheduler.tick()
    expect(start).toHaveBeenCalledTimes(1)
    expect(scheduler.runs(saved.id).map(run => run.outcome)).toEqual(['skipped-busy', 'started'])
    working = false
    at(START + 3 * HOUR)
    await scheduler.tick()
    expect(start).toHaveBeenCalledTimes(2)
  })

  test('no more runs in a day than a schedule may make', async () => {
    const { scheduler, start, at, db } = setup()
    const saved = scheduler.save(daily({ rule: { kind: 'hours', every: 1, anchor: START + HOUR } }))
    const store = new ScheduleStore(db)
    for (let index = 0; index < SCHEDULE_LIMITS.runsPerDay; index++) store.record({ scheduleId: saved.id, dueAt: START, at: START + index, outcome: 'started', threadId: `earlier-${index}`, detail: null })
    at(START + HOUR)
    await scheduler.tick()
    expect(start).not.toHaveBeenCalled()
    expect(scheduler.runs(saved.id)[0].outcome).toBe('skipped-limit')
  })

  test('a run that cannot start is recorded with its reason; three in a row turn the schedule off and say why', async () => {
    const { scheduler, one, at } = setup({ start: async () => { throw new Error('OxeChat project is unavailable. Restore or add the project first.') } })
    const saved = scheduler.save(daily({ rule: { kind: 'hours', every: 1, anchor: START + HOUR } }))
    for (let hour = 1; hour <= 3; hour++) { at(START + hour * HOUR); await scheduler.tick() }
    expect(scheduler.runs(saved.id).map(run => run.outcome)).toEqual(['failed', 'failed', 'failed'])
    expect(scheduler.runs(saved.id)[0].detail).toContain('project is unavailable')
    expect(one()).toMatchObject({ enabled: false, pausedReason: 'failures', failures: 3, nextRunAt: null })
    at(START + 4 * HOUR)
    await scheduler.tick()
    expect(scheduler.runs(saved.id)).toHaveLength(3)
    // Turned on again by the person, it starts counting again.
    scheduler.setEnabled(saved.id, true)
    expect(one()).toMatchObject({ enabled: true, pausedReason: null, failures: 0, nextRunAt: START + 5 * HOUR })
  })

  test('a single time runs once and is then off; one already past cannot be turned on again', async () => {
    const { scheduler, start, one, at } = setup()
    const saved = scheduler.save(daily({ rule: { kind: 'once', at: START + HOUR } }))
    at(START + HOUR)
    await scheduler.tick()
    expect(start).toHaveBeenCalledTimes(1)
    expect(one()).toMatchObject({ enabled: false, nextRunAt: null, pausedReason: null })
    expect(() => scheduler.setEnabled(saved.id, true)).toThrow(ScheduleRefused)
  })

  test('"pause all" stops everything; when it ends, what was due meanwhile is decided once', async () => {
    const { scheduler, start, at } = setup()
    const saved = scheduler.save(daily({ rule: { kind: 'hours', every: 1, anchor: START + HOUR } }))
    scheduler.setPaused(true)
    at(START + 5 * HOUR + 600_000)
    await scheduler.tick()
    expect(start).not.toHaveBeenCalled()
    expect(scheduler.runs(saved.id)).toEqual([])
    scheduler.setPaused(false)
    await scheduler.tick()
    expect(start).not.toHaveBeenCalled()
    expect(scheduler.runs(saved.id).map(run => run.outcome)).toEqual(['missed'])
  })

  test('a schedule that is off does not run, and "Run now" runs it without moving when it is next due', async () => {
    const { scheduler, start, one, at } = setup()
    const saved = scheduler.save(daily())
    scheduler.setEnabled(saved.id, false)
    at(saved.nextRunAt! + 1000)
    await scheduler.tick()
    expect(start).not.toHaveBeenCalled()
    scheduler.setEnabled(saved.id, true)
    const next = one().nextRunAt
    const run = await scheduler.runNow(saved.id)
    expect(run).toMatchObject({ outcome: 'started', threadId: 'thread-1' })
    expect(one().nextRunAt).toBe(next)
  })

  test('each schedule keeps only its last runs', async () => {
    const { scheduler, db } = setup()
    const saved = scheduler.save(daily())
    const store = new ScheduleStore(db)
    for (let index = 0; index < SCHEDULE_LIMITS.history + 12; index++) store.record({ scheduleId: saved.id, dueAt: START, at: START + index, outcome: 'missed', threadId: null, detail: null })
    expect(scheduler.runs(saved.id)).toHaveLength(SCHEDULE_LIMITS.history)
    expect(scheduler.runs(saved.id)[0].at).toBe(START + SCHEDULE_LIMITS.history + 11)
  })
})

describe('schedules: a run is a conversation like any other', () => {
  test('created in the schedule\'s project, named after it, with its access and no more, then sent the request', async () => {
    const calls: string[] = []
    const service = {
      create: vi.fn((context: { workspaceId: string; projectId: string; rootPath: string; provider: string }) => { calls.push(`create ${context.workspaceId} ${context.rootPath} ${context.provider}`); return { thread: { id: 't1', configurationRevision: 0 } } }),
      command: vi.fn(async (id: string, text: string) => { calls.push(`command ${id} ${text}`); return { kind: 'applied' } }),
      configure: vi.fn(async (id: string, input: Record<string, unknown>, revision: number) => { calls.push(`configure ${id} ${JSON.stringify(input)} ${revision}`); return {} }),
      send: vi.fn(async (id: string, text: string) => { calls.push(`send ${id} ${text}`) }),
      read: vi.fn((id: string) => ({ thread: { id, configurationRevision: 2, status: 'running' } }))
    }
    const runner = scheduleThreadRunner({ service: async () => service as never, context: (projectId, rootPath) => { if (projectId !== 'p1') throw new Error('OxeChat project is unavailable.'); return { projectId, rootPath } } })
    const db = openInMemoryDatabase(); open.push(db)
    const scheduler = new Scheduler({ store: new ScheduleStore(db), ...runner, now: () => START })
    const saved = scheduler.save(daily({ access: 'workspace-write', confirmedWrite: true, model: 'fable-5-2' }))
    expect(await scheduler.runNow(saved.id)).toMatchObject({ outcome: 'started', threadId: 't1' })
    expect(calls).toEqual([
      'create thread:p1 C:/work/shop claude',
      'command t1 /rename Morning review',
      'configure t1 {"access":"workspace-write","model":"fable-5-2"} 2',
      'send t1 Review what changed.'
    ])
    // No approval policy is ever set: the run asks, and waits, like a person's conversation.
    expect(JSON.stringify(service.configure.mock.calls)).not.toMatch(/approvalPolicy|full-access|acceptEdits/)
    expect(await runner.busy('t1')).toBe(true)
    expect(runner.knownProject('p1', 'C:/work/shop')).toBe(true)
    expect(runner.knownProject('gone', 'C:/work/shop')).toBe(false)
    expect(() => scheduler.save(daily({ projectId: 'gone' }))).toThrow(ScheduleRefused)
  })
})
