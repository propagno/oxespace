import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { nextOccurrence, parseCron, validateSchedule } from '../../electron/main/services/automations/schedule'
import { AutomationService, TICK_MS } from '../../electron/main/services/automations/service'
import { AutomationStore } from '../../electron/main/services/automations/store'
import type { HookOutcome, RunHookOptions } from '../../electron/main/services/repo-config/hook-runner'
import type { AutomationInput, AutomationRun } from '../../shared/types/automation'

const local = (y: number, mo: number, d: number, h = 0, mi = 0): number => new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

describe('schedule arithmetic', () => {
  test('interval adds minutes and enforces a floor', () => {
    expect(nextOccurrence({ kind: 'interval', everyMinutes: 30 }, 1000)).toBe(1000 + 30 * 60_000)
    expect(validateSchedule({ kind: 'interval', everyMinutes: 1 })).toMatch(/mínimo/)
    expect(nextOccurrence({ kind: 'interval', everyMinutes: 1 }, 0)).toBeNull()
  })

  test('daily picks today when still ahead, otherwise tomorrow', () => {
    const schedule = { kind: 'daily' as const, hour: 9, minute: 30 }
    expect(nextOccurrence(schedule, local(2026, 10, 12, 8, 0))).toBe(local(2026, 10, 12, 9, 30))
    expect(nextOccurrence(schedule, local(2026, 10, 12, 9, 30))).toBe(local(2026, 10, 13, 9, 30))
    expect(nextOccurrence(schedule, local(2026, 10, 12, 23, 59))).toBe(local(2026, 10, 13, 9, 30))
  })

  test('weekly honours the day set', () => {
    // 2026-10-12 is a Monday; ask for Wednesday (3) and Sunday (0).
    const schedule = { kind: 'weekly' as const, days: [3, 0], hour: 7, minute: 0 }
    expect(new Date(nextOccurrence(schedule, local(2026, 10, 12, 12, 0))!).getDay()).toBe(3)
    expect(new Date(nextOccurrence(schedule, local(2026, 10, 14, 12, 0))!).getDay()).toBe(0)
    expect(validateSchedule({ kind: 'weekly', days: [], hour: 1, minute: 0 })).toMatch(/dia/)
  })

  test('cron fields, steps and the day-of-month/day-of-week OR rule', () => {
    expect(parseCron('*/15 9-17 * * 1-5')).not.toBeNull()
    expect(parseCron('61 * * * *')).toBeNull()
    expect(parseCron('* * *')).toBeNull()
    expect(nextOccurrence({ kind: 'cron', expression: '*/15 * * * *' }, local(2026, 10, 12, 10, 7))).toBe(local(2026, 10, 12, 10, 15))
    expect(nextOccurrence({ kind: 'cron', expression: '0 6 * * *' }, local(2026, 10, 12, 6, 0))).toBe(local(2026, 10, 13, 6, 0))
    // "the 1st OR any Monday": Monday 2026-10-12 matches via day-of-week.
    expect(nextOccurrence({ kind: 'cron', expression: '0 8 1 * 1' }, local(2026, 10, 11, 12, 0))).toBe(local(2026, 10, 12, 8, 0))
    expect(nextOccurrence({ kind: 'cron', expression: 'nonsense' }, 0)).toBeNull()
  })
})

describe('AutomationService', () => {
  let store: AutomationStore
  let now: number
  let events: Array<AutomationRun | null>
  let created: Array<{ branch: string; path: string; baseRef?: string }>
  let commands: Array<{ script: string; options: RunHookOptions }>
  let outcome: (script: string) => HookOutcome | Promise<HookOutcome>
  let worktreeOk: boolean
  let service: AutomationService

  const input = (over: Partial<AutomationInput> = {}): AutomationInput => ({
    name: 'Nightly review',
    prompt: 'Review open PRs',
    rootPath: 'C:\\code\\app',
    agent: 'claude',
    schedule: { kind: 'interval', everyMinutes: 60 },
    ...over
  })

  beforeEach(() => {
    store = new AutomationStore(':memory:')
    now = local(2026, 10, 12, 8, 0)
    events = []
    created = []
    commands = []
    worktreeOk = true
    outcome = () => ({ status: 'passed', output: 'all good' })
    service = new AutomationService({
      store,
      now: () => now,
      createWorktree: async (i) => {
        created.push({ branch: i.branch, path: i.path, baseRef: i.baseRef })
        return worktreeOk ? { ok: true, message: 'ok' } : { ok: false, message: 'git exploded' }
      },
      resolveBaseRef: async () => 'origin/main',
      runCommand: async (script, options) => {
        commands.push({ script, options })
        return outcome(script)
      },
      onChange: (e) => events.push(e.run)
    })
  })
  afterEach(() => store.close())

  test('a due occurrence runs the agent in a fresh worktree with the prompt on stdin', async () => {
    const a = service.create(input())
    expect(a.nextRunAt).toBe(now + 60 * 60_000)
    now = a.nextRunAt! + 1000
    await service.tick()
    await service.idle()

    expect(created).toHaveLength(1)
    expect(created[0].branch).toMatch(/^auto-nightly-review-\d{8}t\d{6}$/)
    expect(created[0].path).toMatch(/app-worktrees/)
    expect(created[0].baseRef).toBe('origin/main')
    expect(commands.at(-1)).toMatchObject({ script: 'claude -p', options: { input: 'Review open PRs', cwd: created[0].path } })

    const [run] = service.runs(a.id)
    expect(run).toMatchObject({ status: 'completed', exitCode: 0, branch: created[0].branch })
    // The next occurrence was scheduled from now, not left in the past.
    expect(service.list()[0].nextRunAt).toBeGreaterThan(now)
  })

  test('codex uses exec with stdin and appends extra args', async () => {
    const a = service.create(input({ agent: 'codex', extraArgs: '--full-auto', baseBranch: 'develop' }))
    now = a.nextRunAt!
    await service.tick()
    await service.idle()
    expect(commands.at(-1)!.script).toBe('codex exec - --full-auto')
    expect(created[0].baseRef).toBe('develop')
  })

  test('an occurrence is consumed exactly once even if ticked repeatedly', async () => {
    const a = service.create(input())
    now = a.nextRunAt!
    await Promise.all([service.tick(), service.tick()])
    await service.tick()
    await service.idle()
    expect(service.runs(a.id).filter((r) => r.status !== 'skipped_busy')).toHaveLength(1)
    expect(created).toHaveLength(1)
  })

  test('a wake-up long after the schedule is skipped, not run late', async () => {
    const a = service.create(input({ graceMinutes: 10 }))
    now = a.nextRunAt! + 3 * 60 * 60_000
    await service.tick()
    await service.idle()
    expect(created).toHaveLength(0)
    expect(service.runs(a.id)[0].status).toBe('skipped_missed')
    // ...and the schedule moves forward instead of looping on the stale slot.
    expect(service.list()[0].nextRunAt).toBeGreaterThan(now)
  })

  test('the grace window tolerates a slightly late tick', async () => {
    const a = service.create(input({ graceMinutes: 10 }))
    now = a.nextRunAt! + 5 * 60_000
    await service.tick()
    await service.idle()
    expect(created).toHaveLength(1)
  })

  test('a failing precheck skips the run without creating a worktree', async () => {
    outcome = (script) => (script === 'test -f ready' ? { status: 'failed', exitCode: 1, output: 'nope' } : { status: 'passed', output: '' })
    const a = service.create(input({ precheck: 'test -f ready' }))
    now = a.nextRunAt!
    await service.tick()
    await service.idle()
    expect(created).toHaveLength(0)
    expect(service.runs(a.id)[0].status).toBe('skipped_precheck')
  })

  test('worktree failure is dispatch_failed and the agent never starts', async () => {
    worktreeOk = false
    const a = service.create(input())
    now = a.nextRunAt!
    await service.tick()
    await service.idle()
    const run = service.runs(a.id)[0]
    expect(run).toMatchObject({ status: 'dispatch_failed', message: 'git exploded' })
    expect(commands.filter((c) => c.script.startsWith('claude'))).toHaveLength(0)
  })

  test('agent failure and timeout are failed with a reason', async () => {
    outcome = () => ({ status: 'failed', exitCode: 2, output: 'boom' })
    const a = service.create(input())
    now = a.nextRunAt!
    await service.tick()
    await service.idle()
    expect(service.runs(a.id)[0]).toMatchObject({ status: 'failed', exitCode: 2, outputTail: 'boom' })

    outcome = () => ({ status: 'unverifiable', reason: 'timeout', output: '' })
    now += 2 * 60 * 60_000
    service.setEnabled(a.id, true)
    now = service.list()[0].nextRunAt!
    await service.tick()
    await service.idle()
    expect(service.runs(a.id)[0].message).toMatch(/tempo limite/)
  })

  test('a run in flight makes the next occurrence skipped_busy', async () => {
    let release!: () => void
    outcome = (script) =>
      script.startsWith('claude')
        ? new Promise<HookOutcome>((resolve) => { release = () => resolve({ status: 'passed', output: '' }) })
        : { status: 'passed', output: '' }
    const a = service.create(input())
    now = a.nextRunAt!
    await service.tick()
    await new Promise((r) => setTimeout(r, 20))
    expect(service.runs(a.id)[0].status).toBe('running')

    now = service.list()[0].nextRunAt!
    await service.tick()
    expect(service.runs(a.id)[0].status).toBe('skipped_busy')
    release()
    await service.idle()
  })

  test('disabled automations never fire and re-enabling reschedules', async () => {
    const a = service.create(input({ enabled: false }))
    expect(a.nextRunAt).toBeNull()
    now += 10 * 60 * 60_000
    await service.tick()
    expect(created).toHaveLength(0)
    expect(service.setEnabled(a.id, true).nextRunAt).toBeGreaterThan(now)
  })

  test('runNow executes immediately and rejects an unknown id', async () => {
    const a = service.create(input())
    await service.runNow(a.id)
    await service.idle()
    expect(created).toHaveLength(1)
    await expect(service.runNow('missing')).rejects.toThrow(/não encontrada/)
  })

  test('validation rejects bad input', () => {
    expect(() => service.create(input({ name: ' ' }))).toThrow(/nome/)
    expect(() => service.create(input({ prompt: '' }))).toThrow(/prompt/)
    expect(() => service.create(input({ schedule: { kind: 'cron', expression: 'x' } }))).toThrow(/cron/)
    expect(() => service.create(input({ timeoutMinutes: 0 }))).toThrow(/limite/)
  })

  test('runs interrupted by a restart are failed on start', async () => {
    const a = service.create(input())
    const run = store.createRun(a.id, now, 'pending')!
    store.updateRun(run.id, { status: 'running' })
    service.start()
    service.stop()
    expect(store.getRun(run.id)).toMatchObject({ status: 'failed' })
    expect(TICK_MS).toBe(60_000)
  })
})
