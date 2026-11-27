// @vitest-environment node
// Frozen acceptance test for OXE-446 (A4): 5-field local cron parser, exact nextRunAt + next 3 local occurrences,
// and deterministic refusal code 'cron' for invalid expressions.
import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../../electron/main/db'
import { ScheduleStore } from '../../../electron/main/services/schedules/schedule-store'
import { ScheduleRefused, Scheduler } from '../../../electron/main/services/schedules/scheduler'
import { isValidCronExpression, nextCronRun, nextCronRuns, parseCronExpression } from '../../../shared/cron'
import { nextRun, nextRuns, scheduleRefusal, type ScheduleInput } from '../../../shared/schedule'

const openDbs: AppDatabase[] = []
afterEach(() => { for (const db of openDbs.splice(0)) db.close() })

const baseInput = (expression: string): ScheduleInput => ({
  name: 'Cron Job',
  projectId: 'p1',
  rootPath: 'C:/work/repo',
  provider: 'claude',
  access: 'read-only',
  prompt: 'Run cron check.',
  rule: { kind: 'cron', expression }
})

describe('OXE-446 A4 · 5-field local cron parser, 3-run preview, and deterministic refusal', () => {
  it('computes exact local nextRunAt and next 3 occurrences for ranges, steps, lists, and named fields', () => {
    // 2026-05-01 is a Friday. 08:10 local time.
    const fridayMorning = new Date(2026, 4, 1, 8, 10, 0, 0).getTime()

    // Step syntax: every 15 minutes
    const stepRuns = nextCronRuns('*/15 * * * *', fridayMorning, 3)
    expect(stepRuns).toEqual([
      new Date(2026, 4, 1, 8, 15, 0, 0).getTime(),
      new Date(2026, 4, 1, 8, 30, 0, 0).getTime(),
      new Date(2026, 4, 1, 8, 45, 0, 0).getTime()
    ])
    expect(nextRun({ kind: 'cron', expression: '*/15 * * * *' }, fridayMorning)).toBe(stepRuns[0])
    expect(nextRuns({ kind: 'cron', expression: '*/15 * * * *' }, fridayMorning, 3)).toEqual(stepRuns)

    // Weekday range: 09:30 Mon-Fri (skips Sat May 2 and Sun May 3)
    const weekdayRuns = nextCronRuns('30 9 * * 1-5', fridayMorning, 3)
    expect(weekdayRuns).toEqual([
      new Date(2026, 4, 1, 9, 30, 0, 0).getTime(),
      new Date(2026, 4, 4, 9, 30, 0, 0).getTime(),
      new Date(2026, 4, 5, 9, 30, 0, 0).getTime()
    ])

    // List syntax: 1st and 15th at 08:00 (after 08:10 on May 1 -> May 15, Jun 1, Jun 15)
    const listRuns = nextCronRuns('0 8 1,15 * *', fridayMorning, 3)
    expect(listRuns).toEqual([
      new Date(2026, 4, 15, 8, 0, 0, 0).getTime(),
      new Date(2026, 5, 1, 8, 0, 0, 0).getTime(),
      new Date(2026, 5, 15, 8, 0, 0, 0).getTime()
    ])

    // Named month & weekday + Sunday as 7
    expect(parseCronExpression('0 10 * JAN MON')).not.toBeNull()
    expect(parseCronExpression('0 12 * * 7')?.daysOfWeek).toEqual([0])
    const janMon = nextCronRun('0 10 * JAN MON', new Date(2026, 11, 31, 23, 0, 0, 0).getTime())
    expect(janMon).toBe(new Date(2027, 0, 4, 10, 0, 0, 0).getTime())
  })

  it('rejects invalid 5-field cron expressions deterministically with refusal code "cron"', () => {
    const now = new Date(2026, 4, 1, 8, 10, 0, 0).getTime()
    const invalidExpressions = [
      '',
      '* * *',
      '* * * * * *',
      '60 * * * *',
      '0 25 * * *',
      '0 0 32 * *',
      '0 0 * 13 *',
      '0 0 * * 8',
      '*/0 * * * *',
      '5-2 * * * *',
      'not-a-cron'
    ]

    for (const expression of invalidExpressions) {
      expect(isValidCronExpression(expression), expression).toBe(false)
      expect(parseCronExpression(expression), expression).toBeNull()
      expect(scheduleRefusal(baseInput(expression), now), expression).toBe('cron')
    }

    const db = openInMemoryDatabase(); openDbs.push(db)
    const scheduler = new Scheduler({
      store: new ScheduleStore(db),
      start: async () => ({ threadId: 't1' }),
      busy: async () => false,
      knownProject: () => true,
      now: () => now
    })

    let refusedCode: string | null = null
    try {
      scheduler.save(baseInput('99 * * * *'))
    } catch (error) {
      refusedCode = error instanceof ScheduleRefused ? error.code : null
    }
    expect(refusedCode).toBe('cron')

    const saved = scheduler.save(baseInput('*/15 * * * *'))
    expect(saved.triggerKind).toBe('cron')
    expect(saved.nextRunAt).toBe(new Date(2026, 4, 1, 8, 15, 0, 0).getTime())
  })
})
