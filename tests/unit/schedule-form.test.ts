// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { EVERY_DAY, fieldMoment, formCheck, formOf, inputOf, localFieldValue, newScheduleForm, ruleOf } from '../../src/components/Schedules/scheduleForm'
import type { Schedule } from '../../shared/schedule'

const now = new Date(2026, 10, 12, 14, 20).getTime()
const project = { projectId: 'p1', rootPath: 'C:/work/shop' }

describe('the Schedules form', () => {
  test('a date and time field holds local time, there and back', () => {
    expect(localFieldValue(new Date(2026, 0, 5, 7, 3).getTime())).toBe('2026-01-05T07:03')
    expect(fieldMoment('2026-01-05T07:03')).toBe(new Date(2026, 0, 5, 7, 3).getTime())
    expect(fieldMoment('')).toBeNaN()
    expect(fieldMoment('05/01/2026 07:03')).toBeNaN()
  })

  test('a new form is every day at nine, read only, with a single time already a full hour ahead', () => {
    const form = newScheduleForm(project, now)
    expect(form).toMatchObject({ projectId: 'p1', rootPath: 'C:/work/shop', provider: 'claude', access: 'read-only', kind: 'daily', time: '09:00', days: EVERY_DAY, catchUp: false, onceAt: '2026-11-12T16:00' })
    expect(formCheck(form, now).refusal).toBe('name')
  })

  test('a filled form says when it would first run', () => {
    const form = { ...newScheduleForm(project, now), name: 'Morning review', prompt: 'Review what changed.' }
    expect(formCheck(form, now)).toEqual({ refusal: null, firstRun: new Date(2026, 10, 13, 9, 0).getTime() })
    expect(formCheck({ ...form, kind: 'once', onceAt: '2026-11-12T18:00' }, now).firstRun).toBe(new Date(2026, 10, 12, 18, 0).getTime())
    expect(formCheck({ ...form, kind: 'once', onceAt: '2026-11-12T10:00' }, now).refusal).toBe('past')
    expect(formCheck({ ...form, kind: 'hours', every: '6' }, now).firstRun).toBe(now + 6 * 3_600_000)
    expect(formCheck({ ...form, kind: 'hours', every: '0.5' }, now).refusal).toBe('every')
    expect(formCheck({ ...form, days: [] }, now).refusal).toBe('days')
  })

  test('changing files is confirmed on Save, not while typing: the check does not ask for it, the input carries it only when given', () => {
    const form = { ...newScheduleForm(project, now), name: 'Fix lint', prompt: 'Fix lint errors.', access: 'workspace-write' as const }
    expect(formCheck(form, now).refusal).toBeNull()
    expect(inputOf(form, now, false).confirmedWrite).toBeUndefined()
    expect(inputOf(form, now, true).confirmedWrite).toBe(true)
  })

  test('a saved schedule comes back into the form as it was set', () => {
    const base: Omit<Schedule, 'rule'> = { id: 's1', name: 'Weekly notes', projectId: 'p1', rootPath: 'C:/work/shop', provider: 'codex', model: null, access: 'read-only', prompt: 'Write the notes.', enabled: true, catchUp: true, createdAt: 1, updatedAt: 1, nextRunAt: null, lastRunAt: null, failures: 0, pausedReason: null }
    const weekly = formOf({ ...base, rule: { kind: 'daily', time: '18:30', days: [5, 1] } }, now)
    expect(weekly).toMatchObject({ id: 's1', provider: 'codex', kind: 'daily', time: '18:30', days: [1, 5], catchUp: true })
    expect(ruleOf(weekly, now)).toEqual({ kind: 'daily', time: '18:30', days: [1, 5] })
    expect(formOf({ ...base, rule: { kind: 'hours', every: 12, anchor: 5 } }, now)).toMatchObject({ kind: 'hours', every: '12' })
    expect(formOf({ ...base, rule: { kind: 'once', at: new Date(2026, 11, 1, 8, 0).getTime() } }, now)).toMatchObject({ kind: 'once', onceAt: '2026-12-01T08:00' })
    expect(inputOf(weekly, now, false)).toMatchObject({ id: 's1', name: 'Weekly notes', provider: 'codex' })
  })
})
