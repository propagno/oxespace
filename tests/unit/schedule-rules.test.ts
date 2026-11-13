// @vitest-environment node
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { SCHEDULE_LATE_MS, SCHEDULE_LIMITS, decideDue, localDayStart, nextRun, scheduleRefusal, type ScheduleInput } from '../../shared/schedule'

// A zone whose clocks change, so the hour that does not exist and the hour that happens twice can be asked about.
const zone = process.env.TZ
beforeAll(() => { process.env.TZ = 'America/New_York' })
afterAll(() => { if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone })

const local = (year: number, month: number, day: number, hour = 0, minute = 0): number => new Date(year, month - 1, day, hour, minute).getTime()
const everyDay = [0, 1, 2, 3, 4, 5, 6]
const input = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({ name: 'Morning review', projectId: 'p1', rootPath: 'C:/work/shop', provider: 'claude', access: 'read-only', prompt: 'Review what changed since yesterday.', rule: { kind: 'daily', time: '09:00', days: everyDay }, ...over })

describe('when a schedule is next due', () => {
  test('every day at a time: today if the time is still ahead, tomorrow otherwise, and never the moment asked about', () => {
    const rule = { kind: 'daily', time: '09:00', days: everyDay } as const
    expect(nextRun(rule, local(2026, 11, 12, 8, 59))).toBe(local(2026, 11, 12, 9, 0))
    expect(nextRun(rule, local(2026, 11, 12, 9, 0))).toBe(local(2026, 11, 13, 9, 0))
    expect(nextRun(rule, local(2026, 11, 12, 23, 59))).toBe(local(2026, 11, 13, 9, 0))
  })

  test('chosen days of the week: the next of them, a week away at most', () => {
    // 12 November 2026 is a Thursday.
    const mondayAndFriday = { kind: 'daily', time: '18:30', days: [1, 5] } as const
    expect(nextRun(mondayAndFriday, local(2026, 11, 12, 12, 0))).toBe(local(2026, 11, 13, 18, 30))
    expect(nextRun(mondayAndFriday, local(2026, 11, 13, 18, 30))).toBe(local(2026, 11, 16, 18, 30))
    const thursday = { kind: 'daily', time: '08:00', days: [4] } as const
    expect(nextRun(thursday, local(2026, 11, 12, 8, 0))).toBe(local(2026, 11, 19, 8, 0))
  })

  test('the clocks change: the time stays the time on the clock', () => {
    const rule = { kind: 'daily', time: '09:00', days: everyDay } as const
    // Clocks go forward on 8 March 2026 and back on 1 November 2026: the day is 23 and 25 hours long.
    expect(nextRun(rule, local(2026, 3, 7, 9, 0))).toBe(local(2026, 3, 8, 9, 0))
    expect(local(2026, 3, 8, 9, 0) - local(2026, 3, 7, 9, 0)).toBe(23 * 3_600_000)
    expect(nextRun(rule, local(2026, 10, 31, 9, 0))).toBe(local(2026, 11, 1, 9, 0))
    expect(local(2026, 11, 1, 9, 0) - local(2026, 10, 31, 9, 0)).toBe(25 * 3_600_000)
  })

  test('an hour that does not exist runs once, an hour later by the clock; an hour that happens twice runs once', () => {
    const gap = { kind: 'daily', time: '02:30', days: everyDay } as const
    const first = nextRun(gap, local(2026, 3, 7, 12, 0))!
    expect(new Date(first).getHours()).toBe(3)
    expect(new Date(first).getMinutes()).toBe(30)
    expect(new Date(nextRun(gap, first)!).getDate()).toBe(9)
    const twice = { kind: 'daily', time: '01:30', days: everyDay } as const
    const once = nextRun(twice, local(2026, 10, 31, 12, 0))!
    expect(new Date(once).getDate()).toBe(1)
    // The second 01:30 of that night is an hour after the first; the next run is the day after, not that one.
    expect(nextRun(twice, once)! - once).toBeGreaterThan(20 * 3_600_000)
  })

  test('every N hours counts from its anchor, whatever was missed in between', () => {
    const anchor = local(2026, 11, 12, 8, 0)
    const rule = { kind: 'hours', every: 4, anchor } as const
    expect(nextRun(rule, anchor - 1)).toBe(anchor)
    expect(nextRun(rule, anchor)).toBe(anchor + 4 * 3_600_000)
    expect(nextRun(rule, anchor + 9 * 3_600_000)).toBe(anchor + 12 * 3_600_000)
    expect(nextRun(rule, anchor + 500 * 3_600_000 + 1)).toBe(anchor + 504 * 3_600_000)
  })

  test('a single time is due once, then never', () => {
    const at = local(2026, 11, 13, 9, 0)
    expect(nextRun({ kind: 'once', at }, at - 1)).toBe(at)
    expect(nextRun({ kind: 'once', at }, at)).toBeNull()
  })

  test('the local day starts at its own midnight, on the short day and the long one too', () => {
    expect(localDayStart(local(2026, 3, 8, 15, 0))).toBe(local(2026, 3, 8))
    expect(localDayStart(local(2026, 11, 1, 1, 30))).toBe(local(2026, 11, 1))
  })
})

describe('what may be saved as a schedule', () => {
  const now = local(2026, 11, 12, 12, 0)
  test('a complete read-only schedule is accepted', () => {
    expect(scheduleRefusal(input(), now)).toBeNull()
    expect(scheduleRefusal(input({ rule: { kind: 'hours', every: 1, anchor: now } }), now)).toBeNull()
    expect(scheduleRefusal(input({ rule: { kind: 'once', at: now + 60_000 } }), now)).toBeNull()
  })

  test('nothing more often than once an hour, and no more than a day apart', () => {
    for (const every of [0, 0.5, -1, 25, Number.NaN]) expect(scheduleRefusal(input({ rule: { kind: 'hours', every, anchor: now } }), now), String(every)).toBe('every')
  })

  test('changing files with no one watching needs the person\'s yes; full access is never offered', () => {
    expect(scheduleRefusal(input({ access: 'workspace-write' }), now)).toBe('unconfirmedWrite')
    expect(scheduleRefusal(input({ access: 'workspace-write', confirmedWrite: true }), now)).toBeNull()
    expect(scheduleRefusal(input({ access: 'full-access' as never, confirmedWrite: true }), now)).toBe('access')
  })

  test('each missing or malformed part is named', () => {
    expect(scheduleRefusal(input({ name: '  ' }), now)).toBe('name')
    expect(scheduleRefusal(input({ name: 'x'.repeat(SCHEDULE_LIMITS.nameLength + 1) }), now)).toBe('name')
    expect(scheduleRefusal(input({ prompt: '' }), now)).toBe('prompt')
    expect(scheduleRefusal(input({ prompt: 'x'.repeat(SCHEDULE_LIMITS.promptLength + 1) }), now)).toBe('prompt')
    expect(scheduleRefusal(input({ provider: 'cursor' as never }), now)).toBe('provider')
    expect(scheduleRefusal(input({ projectId: '' }), now)).toBe('project')
    expect(scheduleRefusal(input({ rule: { kind: 'daily', time: '9:00', days: everyDay } }), now)).toBe('time')
    expect(scheduleRefusal(input({ rule: { kind: 'daily', time: '24:00', days: everyDay } }), now)).toBe('time')
    expect(scheduleRefusal(input({ rule: { kind: 'daily', time: '09:00', days: [] } }), now)).toBe('days')
    expect(scheduleRefusal(input({ rule: { kind: 'daily', time: '09:00', days: [1, 1] } }), now)).toBe('days')
    expect(scheduleRefusal(input({ rule: { kind: 'daily', time: '09:00', days: [7] } }), now)).toBe('days')
    expect(scheduleRefusal(input({ rule: { kind: 'once', at: now } }), now)).toBe('past')
    expect(scheduleRefusal(input({ rule: { kind: 'weekly' } as never }), now)).toBe('rule')
    expect(scheduleRefusal(null, now)).toBe('name')
  })
})

describe('what happens when a schedule is due', () => {
  const dueAt = local(2026, 11, 12, 9, 0)
  const free = { busy: false, startedToday: 0 }
  test('not due yet, or with no next time: nothing', () => {
    expect(decideDue({ nextRunAt: dueAt, catchUp: false }, dueAt - 1, free)).toBeNull()
    expect(decideDue({ nextRunAt: null, catchUp: true }, dueAt, free)).toBeNull()
  })

  test('on time, it runs', () => {
    expect(decideDue({ nextRunAt: dueAt, catchUp: false }, dueAt + 20_000, free)).toEqual({ act: 'run', dueAt, recovered: false })
    expect(decideDue({ nextRunAt: dueAt, catchUp: false }, dueAt + SCHEDULE_LATE_MS, free)).toEqual({ act: 'run', dueAt, recovered: false })
  })

  test('found late (the app was closed, the computer asleep): missed, or recovered once when the schedule says so', () => {
    const late = dueAt + 5 * 3_600_000
    expect(decideDue({ nextRunAt: dueAt, catchUp: false }, late, free)).toEqual({ act: 'skip', dueAt, outcome: 'missed' })
    expect(decideDue({ nextRunAt: dueAt, catchUp: true }, late, free)).toEqual({ act: 'run', dueAt, recovered: true })
  })

  test('the run before it still at work, or the day\'s limit reached: skipped, with the reason', () => {
    expect(decideDue({ nextRunAt: dueAt, catchUp: true }, dueAt + 1, { busy: true, startedToday: 0 })).toEqual({ act: 'skip', dueAt, outcome: 'skipped-busy' })
    expect(decideDue({ nextRunAt: dueAt, catchUp: true }, dueAt + 1, { busy: false, startedToday: SCHEDULE_LIMITS.runsPerDay })).toEqual({ act: 'skip', dueAt, outcome: 'skipped-limit' })
  })
})
