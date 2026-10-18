/**
 * Scheduler and executor for automations.
 *
 * A tick runs every minute. For each due automation it advances `nextRunAt`
 * FIRST, then records the occurrence (unique per automation + time), so a crash
 * or a slow run can never cause the same occurrence to fire twice. Late wake-ups
 * are skipped rather than run, so a laptop opened at 9am does not launch the
 * 3am job.
 */
import { basename, dirname, join } from 'node:path'
import type { Automation, AutomationInput, AutomationRun } from '../../../../shared/types/automation'
import type { HookOutcome, RunHookOptions } from '../repo-config/hook-runner'
import { nextOccurrence, validateSchedule } from './schedule'
import type { AutomationStore } from './store'

export const TICK_MS = 60_000
const OUTPUT_TAIL_CHARS = 8_000
const AGENT_COMMAND: Record<Automation['agent'], string> = {
  claude: 'claude -p',
  // `-` makes codex read the instructions from stdin.
  codex: 'codex exec -'
}

export interface AutomationServiceDeps {
  store: AutomationStore
  createWorktree(input: {
    rootPath: string
    branch: string
    path: string
    createBranch: boolean
    baseRef?: string
    fetchBase: boolean
  }): Promise<{ ok: boolean; message: string }>
  resolveBaseRef(rootPath: string): Promise<string>
  runCommand(script: string, options: RunHookOptions): Promise<HookOutcome>
  now?: () => number
  onChange?: (event: { automationId: string; run: AutomationRun | null }) => void
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'run'
}

function stamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}t${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function tail(text: string): string {
  return text.length > OUTPUT_TAIL_CHARS ? text.slice(-OUTPUT_TAIL_CHARS) : text
}

export class AutomationService {
  private timer: ReturnType<typeof setInterval> | null = null
  private evaluating = false
  private readonly inFlight = new Set<Promise<void>>()

  constructor(private readonly deps: AutomationServiceDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  start(): void {
    if (this.timer) return
    this.deps.store.failInterruptedRuns(this.now())
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref?.()
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Resolves when every run started so far has settled (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight])
  }

  list(): Automation[] {
    return this.deps.store.list()
  }

  runs(automationId: string): AutomationRun[] {
    return this.deps.store.listRuns(automationId)
  }

  create(input: AutomationInput): Automation {
    this.validate(input)
    const now = this.now()
    const enabled = input.enabled !== false
    const next = enabled ? nextOccurrence(input.schedule, now) : null
    return this.deps.store.create(input, next, now)
  }

  setEnabled(id: string, enabled: boolean): Automation {
    const automation = this.require(id)
    this.deps.store.setEnabled(id, enabled, enabled ? nextOccurrence(automation.schedule, this.now()) : null)
    return this.require(id)
  }

  remove(id: string): void {
    this.deps.store.remove(id)
  }

  /** Manual trigger. Refused while a run of the same automation is in flight. */
  async runNow(id: string): Promise<AutomationRun | null> {
    const automation = this.require(id)
    return this.dispatch(automation, this.now())
  }

  /** Evaluates every enabled automation once; exported for tests and wake-ups. */
  async tick(): Promise<void> {
    if (this.evaluating) return
    this.evaluating = true
    try {
      const now = this.now()
      for (const automation of this.deps.store.list()) {
        if (!automation.enabled || automation.nextRunAt === null || automation.nextRunAt > now) continue
        const scheduledFor = automation.nextRunAt
        // Advance before doing anything else: whatever happens next, this
        // occurrence is consumed exactly once.
        this.deps.store.setNextRun(automation.id, nextOccurrence(automation.schedule, now))
        const lateBy = now - scheduledFor
        if (lateBy > automation.graceMinutes * 60_000 + 2 * TICK_MS) {
          const run = this.deps.store.createRun(automation.id, scheduledFor, 'skipped_missed', 'The scheduled time passed while the app was not running.')
          this.deps.onChange?.({ automationId: automation.id, run })
          continue
        }
        await this.dispatch(automation, scheduledFor)
      }
    } finally {
      this.evaluating = false
    }
  }

  private async dispatch(automation: Automation, scheduledFor: number): Promise<AutomationRun | null> {
    const store = this.deps.store
    if (store.hasActiveRun(automation.id)) {
      const run = store.createRun(automation.id, scheduledFor, 'skipped_busy', 'The previous run is still in progress.')
      this.deps.onChange?.({ automationId: automation.id, run })
      return run
    }
    const run = store.createRun(automation.id, scheduledFor, 'pending')
    if (!run) return null // this occurrence was already recorded
    const work = this.execute(automation, run).catch((error) => {
      const failed = store.updateRun(run.id, {
        status: 'failed',
        finishedAt: this.now(),
        message: error instanceof Error ? error.message : String(error)
      })
      this.deps.onChange?.({ automationId: automation.id, run: failed })
    })
    this.inFlight.add(work)
    void work.finally(() => this.inFlight.delete(work))
    this.deps.onChange?.({ automationId: automation.id, run })
    return run
  }

  private async execute(automation: Automation, run: AutomationRun): Promise<void> {
    const { store } = this.deps
    const emit = (patch: Parameters<AutomationStore['updateRun']>[1]): AutomationRun | null => {
      const updated = store.updateRun(run.id, patch)
      this.deps.onChange?.({ automationId: automation.id, run: updated })
      return updated
    }

    if (automation.precheck) {
      const check = await this.deps.runCommand(automation.precheck, { cwd: automation.rootPath, timeoutMs: 2 * 60_000 })
      if (check.status !== 'passed') {
        emit({ status: 'skipped_precheck', finishedAt: this.now(), outputTail: tail(check.output), message: 'The pre-check did not pass.' })
        return
      }
    }

    const name = `auto-${slug(automation.name)}-${stamp(this.now())}`
    const path = join(dirname(automation.rootPath), `${basename(automation.rootPath)}-worktrees`, name)
    let baseRef: string
    try {
      baseRef = automation.baseBranch ?? (await this.deps.resolveBaseRef(automation.rootPath))
      const created = await this.deps.createWorktree({
        rootPath: automation.rootPath,
        branch: name,
        path,
        createBranch: true,
        baseRef,
        fetchBase: true
      })
      if (!created.ok) throw new Error(created.message)
    } catch (error) {
      emit({
        status: 'dispatch_failed',
        finishedAt: this.now(),
        message: error instanceof Error ? error.message : String(error)
      })
      return
    }

    const startedAt = this.now()
    emit({ status: 'running', startedAt, worktreePath: path, branch: name })
    store.touchLastRun(automation.id, startedAt)

    const command = [AGENT_COMMAND[automation.agent], automation.extraArgs.trim()].filter(Boolean).join(' ')
    const outcome = await this.deps.runCommand(command, {
      cwd: path,
      input: automation.prompt,
      timeoutMs: automation.timeoutMinutes * 60_000
    })

    if (outcome.status === 'passed') {
      emit({ status: 'completed', finishedAt: this.now(), exitCode: 0, outputTail: tail(outcome.output), message: null })
    } else if (outcome.status === 'failed') {
      emit({ status: 'failed', finishedAt: this.now(), exitCode: outcome.exitCode, outputTail: tail(outcome.output), message: `The agent exited with code ${outcome.exitCode}.` })
    } else {
      emit({
        status: 'failed',
        finishedAt: this.now(),
        outputTail: tail(outcome.output),
        message: outcome.reason === 'timeout' ? 'The agent exceeded its time limit and was stopped.' : 'The agent ended without a verifiable result.'
      })
    }
  }

  private require(id: string): Automation {
    const automation = this.deps.store.get(id)
    if (!automation) throw new Error('Automation not found.')
    return automation
  }

  private validate(input: AutomationInput): void {
    if (!input.name.trim()) throw new Error('Informe um nome.')
    if (!input.prompt.trim()) throw new Error('Informe o prompt.')
    if (!input.rootPath.trim()) throw new Error('Choose a repository.')
    if (input.agent !== 'claude' && input.agent !== 'codex') throw new Error('Invalid agent.')
    const scheduleError = validateSchedule(input.schedule)
    if (scheduleError) throw new Error(scheduleError)
    if (input.timeoutMinutes !== undefined && (!Number.isInteger(input.timeoutMinutes) || input.timeoutMinutes < 1 || input.timeoutMinutes > 24 * 60)) {
      throw new Error('Invalid time limit.')
    }
  }
}
