/**
 * Agent Work: a supervising Thread plans a set of tasks with dependencies;
 * each task runs in its own worker Thread in the same project. A task becomes
 * ready when what it depends on succeeded, starts when a slot is free, and its
 * result is read from the worker's recorded turns. The supervisor is told,
 * through its own queue, when a task fails or waits for input and when the
 * whole run ends. Budgets stop the run; cancelling stops every worker.
 *
 * Workers never get more access than the supervisor has, never full access,
 * and tasks that may edit files run one at a time per project because they
 * share the working tree.
 */
import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../../db'
import type { ConversationThread, ThreadConfiguration, ThreadSnapshot } from '../../../../shared/types/thread'
import type { WorkEvent, WorkPlanInput, WorkRun, WorkRunStatus, WorkTask, WorkTaskResult, WorkTaskStatus } from '../../../../shared/types/work'
import { turnVerdict } from '../../../../shared/threadTurnVerdict'

export interface WorkHost {
  read(id: string): ThreadSnapshot
  create(context: Pick<ConversationThread, 'workspaceId' | 'projectId' | 'rootPath' | 'provider' | 'agentProfileId' | 'parent'>): ThreadSnapshot
  configure(id: string, input: ThreadConfiguration, revision: number): Promise<unknown>
  command(id: string, text: string): Promise<unknown>
  send(id: string, text: string): Promise<void>
  interrupt(id: string): Promise<void>
  subscribe(id: string, listener: () => void): () => void
}

export interface WorkLimits {
  perProject: number
  global: number
  tasksPerRun: number
  activeRunsPerSupervisor: number
  wakesPerRun: number
  /** Notes that arrive within this window reach the supervisor as one message. */
  wakeDelayMs: number
}

const DEFAULT_LIMITS: WorkLimits = { perProject: 4, global: 12, tasksPerRun: 12, activeRunsPerSupervisor: 3, wakesPerRun: 30, wakeDelayMs: 1500 }
const TERMINAL = new Set<WorkTaskStatus>(['succeeded', 'failed', 'cancelled'])
export const NEEDS_INPUT = 'Waiting for an answer in the worker conversation'
const MAX_PROMPT_BYTES = 32 * 1024
const MAX_SUMMARY = 4000
const DEPENDENCY_SUMMARY = 1500

interface RunRow { id: string; supervisor_thread_id: string; workspace_id: string; project_id: string; project_root: string; request_key: string; title: string; status: WorkRunStatus; depth: number; budget_usd: number | null; budget_turns: number | null; auto_wake: number; wakes: number; created_at: number; updated_at: number }
interface TaskRow { id: string; run_id: string; key: string; title: string; prompt: string; provider: WorkTask['provider']; access: WorkTask['access']; status: WorkTaskStatus; thread_id: string | null; turn_base: number; reason: string | null; result_json: string | null; position: number; started_at: number | null; finished_at: number | null }

export class WorkError extends Error {}

const text = (value: unknown, label: string, max: number): string => {
  if (typeof value !== 'string' || !value.trim()) throw new WorkError(`${label} is required`)
  const trimmed = value.trim()
  if (Buffer.byteLength(trimmed) > max) throw new WorkError(`${label} is longer than ${max} bytes`)
  return trimmed
}

/** Validates a plan and returns its tasks in an order where dependencies come first. */
export function validatePlan(input: WorkPlanInput, limits: Pick<WorkLimits, 'tasksPerRun'> = DEFAULT_LIMITS): WorkPlanInput {
  if (!input || typeof input !== 'object') throw new WorkError('A plan is required')
  if (typeof input.key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.key)) throw new WorkError('key must contain 8–100 letters, digits, _ or -')
  const title = text(input.title, 'title', 200)
  if (!Array.isArray(input.tasks) || input.tasks.length === 0) throw new WorkError('A plan needs at least one task')
  if (input.tasks.length > limits.tasksPerRun) throw new WorkError(`A plan can have at most ${limits.tasksPerRun} tasks`)
  const keys = new Set<string>()
  const tasks = input.tasks.map(task => {
    if (!task || typeof task !== 'object') throw new WorkError('Each task must be an object')
    if (typeof task.key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(task.key)) throw new WorkError('Each task key must be 1–40 letters, digits, _ or -')
    if (keys.has(task.key)) throw new WorkError(`Task key ${task.key} is used twice`)
    keys.add(task.key)
    const dependsOn = task.dependsOn ?? []
    if (!Array.isArray(dependsOn) || dependsOn.some(value => typeof value !== 'string')) throw new WorkError(`dependsOn of ${task.key} must list task keys`)
    if (task.access !== undefined && task.access !== 'read-only' && task.access !== 'workspace-write') throw new WorkError(`access of ${task.key} must be read-only or workspace-write`)
    if (task.provider !== undefined && task.provider !== 'claude' && task.provider !== 'codex') throw new WorkError(`provider of ${task.key} must be claude or codex`)
    return { key: task.key, title: text(task.title, `title of ${task.key}`, 200), prompt: text(task.prompt, `prompt of ${task.key}`, MAX_PROMPT_BYTES), dependsOn: [...new Set(dependsOn)], ...(task.access ? { access: task.access } : {}), ...(task.provider ? { provider: task.provider } : {}) }
  })
  for (const task of tasks) for (const dependency of task.dependsOn) {
    if (dependency === task.key) throw new WorkError(`${task.key} cannot depend on itself`)
    if (!keys.has(dependency)) throw new WorkError(`${task.key} depends on unknown task ${dependency}`)
  }
  // Kahn's algorithm: anything left over is part of a cycle.
  const ordered: typeof tasks = []
  const remaining = new Map(tasks.map(task => [task.key, new Set(task.dependsOn)]))
  while (remaining.size) {
    const free = tasks.filter(task => remaining.get(task.key)?.size === 0)
    if (!free.length) throw new WorkError(`The plan has a dependency cycle among ${[...remaining.keys()].join(', ')}`)
    for (const task of free) { remaining.delete(task.key); ordered.push(task) }
    for (const pending of remaining.values()) for (const task of free) pending.delete(task.key)
  }
  const budget = input.budget ?? {}
  if (budget.usd !== undefined && !(typeof budget.usd === 'number' && budget.usd > 0 && budget.usd <= 1000)) throw new WorkError('budget.usd must be greater than 0 and at most 1000')
  if (budget.turns !== undefined && !(Number.isInteger(budget.turns) && budget.turns >= 1 && budget.turns <= 500)) throw new WorkError('budget.turns must be an integer from 1 to 500')
  return { key: input.key, title, tasks: ordered, budget: { ...(budget.usd !== undefined ? { usd: budget.usd } : {}), ...(budget.turns !== undefined ? { turns: budget.turns } : {}) }, autoWake: input.autoWake !== false }
}

function workerPrompt(run: RunRow, task: TaskRow, dependencies: TaskRow[]): string {
  const parts = [
    `You are a worker in the OXESpace Agent Work run "${run.title}". Your task: ${task.title}.`,
    task.access === 'read-only' ? 'This task is read-only: investigate and report, do not change files.' : 'Other workers may run read-only tasks in the same project while you work; keep your changes to what this task needs.',
    '',
    task.prompt
  ]
  const finished = dependencies.map(dependency => {
    const result = dependency.result_json ? JSON.parse(dependency.result_json) as WorkTaskResult : undefined
    if (!result) return ''
    const summary = result.summary.length > DEPENDENCY_SUMMARY ? `${result.summary.slice(0, DEPENDENCY_SUMMARY)}…` : result.summary
    return `### ${dependency.key}: ${dependency.title}\n${summary}${result.filesChanged.length ? `\nFiles changed: ${result.filesChanged.slice(0, 30).join(', ')}` : ''}`
  }).filter(Boolean)
  if (finished.length) parts.push('', 'Results of the tasks this one depends on:', ...finished)
  parts.push('', 'End with a short summary of what you did, what you found and what remains. That summary is returned to the supervisor.')
  return parts.join('\n')
}

export class WorkService {
  private readonly limits: WorkLimits
  private readonly watches = new Map<string, () => void>()
  private readonly launching = new Set<string>()
  private readonly notes = new Map<string, string[]>()
  private readonly wakeTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private scheduling = false
  private scheduleAgain = false
  private stopped = false

  constructor(private readonly db: AppDatabase, private readonly host: WorkHost, limits: Partial<WorkLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits }
  }

  /** After a restart: re-attach to workers and settle tasks whose worker no longer runs. */
  resume(): void {
    for (const task of this.db.prepare("SELECT * FROM work_tasks WHERE status IN ('running', 'blocked') AND thread_id IS NOT NULL").all() as TaskRow[]) {
      this.watch(task)
      this.evaluate(task.id, true)
    }
    for (const task of this.db.prepare("SELECT * FROM work_tasks WHERE status = 'running' AND thread_id IS NULL").all() as TaskRow[]) {
      this.finishTask(task, 'failed', 'OXESpace closed before the worker conversation started')
    }
    this.schedule()
  }

  stop(): void {
    this.stopped = true
    for (const unsubscribe of this.watches.values()) unsubscribe()
    this.watches.clear()
    for (const timer of this.wakeTimers.values()) clearTimeout(timer)
    this.wakeTimers.clear()
  }

  plan(supervisorId: string, input: WorkPlanInput): WorkRun {
    const plan = validatePlan(input, this.limits)
    const existing = this.db.prepare('SELECT id FROM work_runs WHERE supervisor_thread_id = ? AND request_key = ?').get(supervisorId, plan.key) as { id: string } | undefined
    if (existing) return this.run(existing.id)
    const supervisor = this.host.read(supervisorId).thread
    const parent = this.db.prepare('SELECT r.depth FROM work_tasks t JOIN work_runs r ON r.id = t.run_id WHERE t.thread_id = ?').get(supervisorId) as { depth: number } | undefined
    const depth = (parent?.depth ?? 0) + 1
    if (depth > 2) throw new WorkError('A worker of a worker cannot plan more work')
    const active = this.db.prepare("SELECT COUNT(*) AS value FROM work_runs WHERE supervisor_thread_id = ? AND status = 'running'").get(supervisorId) as { value: number }
    if (active.value >= this.limits.activeRunsPerSupervisor) throw new WorkError(`This conversation already supervises ${active.value} running plans; wait for one to finish or cancel it`)
    // A worker never gets more access than its supervisor.
    const writable = supervisor.access !== 'read-only' && supervisor.access !== undefined
    const now = Date.now(), runId = randomUUID()
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO work_runs (id, supervisor_thread_id, workspace_id, project_id, project_root, request_key, title, status, depth, budget_usd, budget_turns, auto_wake, wakes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, 0, ?, ?)`).run(runId, supervisorId, supervisor.workspaceId, supervisor.projectId, supervisor.rootPath, plan.key, plan.title, depth,
        plan.budget?.usd ?? null, plan.budget?.turns ?? null, plan.autoWake ? 1 : 0, now, now)
      const ids = new Map<string, string>()
      plan.tasks.forEach((task, position) => {
        const id = randomUUID(); ids.set(task.key, id)
        const access = writable && task.access === 'workspace-write' ? 'workspace-write' : 'read-only'
        this.db.prepare(`INSERT INTO work_tasks (id, run_id, key, title, prompt, provider, access, status, position) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
          .run(id, runId, task.key, task.title, task.prompt, task.provider ?? supervisor.provider, access, position)
      })
      for (const task of plan.tasks) for (const dependency of task.dependsOn ?? []) this.db.prepare('INSERT INTO work_edges (task_id, depends_on) VALUES (?, ?)').run(ids.get(task.key), ids.get(dependency))
      this.event(runId, undefined, 'planned', `${plan.tasks.length} ${plan.tasks.length === 1 ? 'task' : 'tasks'}${plan.budget?.usd ? ` · budget US$ ${plan.budget.usd}` : ''}${plan.budget?.turns ? ` · ${plan.budget.turns} turns` : ''}`)
      const downgraded = plan.tasks.filter(task => task.access === 'workspace-write' && !writable)
      if (downgraded.length) this.event(runId, undefined, 'access', `Read-only supervisor: ${downgraded.map(task => task.key).join(', ')} run read-only`)
    })()
    this.schedule()
    return this.run(runId)
  }

  run(runId: string): WorkRun {
    const row = this.db.prepare('SELECT * FROM work_runs WHERE id = ?').get(runId) as RunRow | undefined
    if (!row) throw new WorkError('Run not found')
    return this.toRun(row)
  }

  /** Runs this conversation supervises, and the run it works for. */
  runsFor(threadId: string, limit = 20): WorkRun[] {
    const rows = this.db.prepare(`SELECT * FROM work_runs WHERE supervisor_thread_id = ? OR id IN (SELECT run_id FROM work_tasks WHERE thread_id = ?)
      ORDER BY created_at DESC LIMIT ?`).all(threadId, threadId, Math.min(100, Math.max(1, limit))) as RunRow[]
    return rows.map(row => this.toRun(row))
  }

  supervised(supervisorId: string, runId: string): WorkRun {
    const run = this.run(runId)
    if (run.supervisorThreadId !== supervisorId) throw new WorkError('This run belongs to another conversation')
    return run
  }

  /** True when the thread is a worker of a run this supervisor owns. */
  isWorkerOf(supervisorId: string, threadId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM work_tasks t JOIN work_runs r ON r.id = t.run_id WHERE t.thread_id = ? AND r.supervisor_thread_id = ?').get(threadId, supervisorId))
  }

  events(runId: string, limit = 100): WorkEvent[] {
    return (this.db.prepare('SELECT * FROM work_events WHERE run_id = ? ORDER BY id DESC LIMIT ?').all(runId, Math.min(500, Math.max(1, limit))) as Array<{ id: number; run_id: string; task_id: string | null; at: number; kind: string; detail: string }>)
      .map(row => ({ id: row.id, runId: row.run_id, at: row.at, kind: row.kind, detail: row.detail, ...(row.task_id ? { taskId: row.task_id } : {}) }))
  }

  /** A follow-up for a task's worker; a finished task runs again with it. */
  async message(runId: string, taskKey: string, message: string): Promise<WorkTask> {
    const body = text(message, 'message', 64 * 1024)
    const run = this.run(runId)
    if (run.status === 'cancelled' || run.status === 'blocked') throw new WorkError(`The run is ${run.status}; plan new work instead`)
    const task = this.taskRow(runId, taskKey)
    if (!task.thread_id) throw new WorkError('The task has not started yet')
    if (task.status === 'cancelled') throw new WorkError('The task was cancelled')
    if (task.status === 'succeeded' || task.status === 'failed') {
      const turns = this.host.read(task.thread_id).turns?.length ?? 0
      this.db.prepare("UPDATE work_tasks SET status = 'running', reason = NULL, turn_base = ?, finished_at = NULL WHERE id = ?").run(turns, task.id)
      this.db.prepare("UPDATE work_runs SET status = 'running', updated_at = ? WHERE id = ?").run(Date.now(), runId)
      this.watch({ ...task, status: 'running' })
    }
    this.event(runId, task.id, 'message', body.slice(0, 500))
    await this.host.send(task.thread_id, body)
    return this.toTask(this.taskRow(runId, taskKey))
  }

  /** Cancels a task, or the whole run, and stops the workers that are still running. */
  async cancel(runId: string, by: 'supervisor' | 'user', taskKey?: string): Promise<WorkRun> {
    const run = this.run(runId)
    const tasks = (taskKey ? [this.taskRow(runId, taskKey)] : this.db.prepare('SELECT * FROM work_tasks WHERE run_id = ?').all(runId) as TaskRow[]).filter(task => !TERMINAL.has(task.status))
    const reason = by === 'user' ? 'Cancelled by the person' : 'Cancelled by the supervisor'
    const running = tasks.filter(task => task.thread_id && (task.status === 'running' || task.status === 'blocked'))
    for (const task of tasks) this.finishTask(task, 'cancelled', reason, false)
    await Promise.allSettled(running.map(task => this.host.interrupt(task.thread_id!)))
    if (!taskKey) this.event(runId, undefined, 'cancelled', reason)
    if (by === 'user' && run.status === 'running') this.note(runId, taskKey ? `The person cancelled task "${taskKey}".` : 'The person cancelled this run.')
    // The supervisor already knows what it cancelled; only the person's cancellation wakes it.
    this.settleRun(runId, by === 'supervisor')
    this.schedule()
    return this.run(runId)
  }

  private taskRow(runId: string, key: string): TaskRow {
    const row = this.db.prepare('SELECT * FROM work_tasks WHERE run_id = ? AND key = ?').get(runId, key) as TaskRow | undefined
    if (!row) throw new WorkError(`Task ${key} not found in this run`)
    return row
  }

  private toTask(row: TaskRow): WorkTask {
    const dependsOn = (this.db.prepare('SELECT d.key FROM work_edges e JOIN work_tasks d ON d.id = e.depends_on WHERE e.task_id = ? ORDER BY d.position').all(row.id) as { key: string }[]).map(value => value.key)
    return { id: row.id, runId: row.run_id, key: row.key, title: row.title, prompt: row.prompt, provider: row.provider, access: row.access, status: row.status, dependsOn,
      ...(row.thread_id ? { threadId: row.thread_id } : {}), ...(row.reason ? { reason: row.reason } : {}),
      ...(row.result_json ? { result: JSON.parse(row.result_json) as WorkTaskResult } : {}),
      ...(row.started_at ? { startedAt: row.started_at } : {}), ...(row.finished_at ? { finishedAt: row.finished_at } : {}) }
  }

  private toRun(row: RunRow): WorkRun {
    const tasks = (this.db.prepare('SELECT * FROM work_tasks WHERE run_id = ? ORDER BY position').all(row.id) as TaskRow[]).map(task => this.toTask(task))
    return { id: row.id, supervisorThreadId: row.supervisor_thread_id, projectRoot: row.project_root, title: row.title, status: row.status, depth: row.depth,
      budget: { ...(row.budget_usd !== null ? { usd: row.budget_usd } : {}), ...(row.budget_turns !== null ? { turns: row.budget_turns } : {}) },
      spent: this.spent(row), autoWake: row.auto_wake === 1, createdAt: row.created_at, updatedAt: row.updated_at, tasks }
  }

  private spent(run: Pick<RunRow, 'id' | 'created_at'>): { usd: number; turns: number } {
    const row = this.db.prepare(`SELECT COALESCE(SUM(usd), 0) AS usd, COUNT(*) AS turns FROM turn_usage
      WHERE at >= ? AND thread_id IN (SELECT thread_id FROM work_tasks WHERE run_id = ? AND thread_id IS NOT NULL)`).get(run.created_at, run.id) as { usd: number; turns: number }
    return { usd: row.usd, turns: row.turns }
  }

  private event(runId: string, taskId: string | undefined, kind: string, detail: string): void {
    this.db.prepare('INSERT INTO work_events (run_id, task_id, at, kind, detail) VALUES (?, ?, ?, ?, ?)').run(runId, taskId ?? null, Date.now(), kind, detail.slice(0, 2000))
  }

  /** Promotes, cancels and starts tasks until nothing changes. Safe to call from anywhere. */
  schedule(): void {
    if (this.stopped) return
    if (this.scheduling) { this.scheduleAgain = true; return }
    this.scheduling = true
    try {
      do {
        this.scheduleAgain = false
        this.promote()
        this.startReady()
      } while (this.scheduleAgain)
    } finally { this.scheduling = false }
  }

  private promote(): void {
    const waiting = this.db.prepare("SELECT t.* FROM work_tasks t JOIN work_runs r ON r.id = t.run_id WHERE r.status = 'running' AND t.status = 'pending'").all() as TaskRow[]
    for (const task of waiting) {
      const dependencies = this.db.prepare('SELECT d.key, d.status FROM work_edges e JOIN work_tasks d ON d.id = e.depends_on WHERE e.task_id = ?').all(task.id) as { key: string; status: WorkTaskStatus }[]
      const broken = dependencies.find(dependency => dependency.status === 'failed' || dependency.status === 'cancelled')
      if (broken) { this.finishTask(task, 'cancelled', `Depends on "${broken.key}", which ${broken.status === 'failed' ? 'failed' : 'was cancelled'}`); continue }
      if (dependencies.every(dependency => dependency.status === 'succeeded')) {
        this.db.prepare("UPDATE work_tasks SET status = 'ready' WHERE id = ? AND status = 'pending'").run(task.id)
      }
    }
  }

  private startReady(): void {
    const ready = this.db.prepare(`SELECT t.*, r.project_root AS root FROM work_tasks t JOIN work_runs r ON r.id = t.run_id
      WHERE r.status = 'running' AND t.status = 'ready' ORDER BY r.created_at, t.position`).all() as Array<TaskRow & { root: string }>
    for (const task of ready) {
      const active = this.db.prepare(`SELECT r.project_root AS root, t.access FROM work_tasks t JOIN work_runs r ON r.id = t.run_id
        WHERE t.status = 'running' OR (t.status = 'blocked' AND t.reason = ?)`).all(NEEDS_INPUT) as { root: string; access: WorkTask['access'] }[]
      if (active.length >= this.limits.global) return
      const inProject = active.filter(value => value.root === task.root)
      if (inProject.length >= this.limits.perProject) continue
      // Writers share the working tree, so they take turns.
      if (task.access === 'workspace-write' && inProject.some(value => value.access === 'workspace-write')) continue
      this.db.prepare("UPDATE work_tasks SET status = 'running', started_at = ? WHERE id = ?").run(Date.now(), task.id)
      this.event(task.run_id, task.id, 'started', task.title)
      this.launching.add(task.id)
      void this.launch(task.id).finally(() => this.launching.delete(task.id))
    }
  }

  private async launch(taskId: string): Promise<void> {
    const task = this.db.prepare('SELECT * FROM work_tasks WHERE id = ?').get(taskId) as TaskRow
    const run = this.db.prepare('SELECT * FROM work_runs WHERE id = ?').get(task.run_id) as RunRow
    try {
      let profile: string | undefined
      try {
        const supervisor = this.host.read(run.supervisor_thread_id).thread
        if (supervisor.provider === task.provider) profile = supervisor.agentProfileId
      } catch { /* The supervisor may be gone; the provider's default profile is used. */ }
      const snapshot = this.host.create({ workspaceId: run.workspace_id, projectId: run.project_id, rootPath: run.project_root, provider: task.provider, ...(profile ? { agentProfileId: profile } : {}), parent: { threadId: run.supervisor_thread_id, via: 'work' } })
      const threadId = snapshot.thread.id
      this.db.prepare('UPDATE work_tasks SET thread_id = ?, turn_base = 0 WHERE id = ?').run(threadId, taskId)
      await this.host.configure(threadId, { access: task.access, approvalPolicy: 'on-request', networkAccess: false, mode: 'default', hooksEnabled: false }, snapshot.thread.configurationRevision ?? 0)
      await this.host.command(threadId, `/rename ${task.title.slice(0, 120)}`).catch(() => {})
      if (this.stopped || this.current(taskId)?.status !== 'running') return
      const dependencies = this.db.prepare('SELECT d.* FROM work_edges e JOIN work_tasks d ON d.id = e.depends_on WHERE e.task_id = ? ORDER BY d.position').all(taskId) as TaskRow[]
      this.watch({ ...task, thread_id: threadId })
      await this.host.send(threadId, workerPrompt(run, task, dependencies))
    } catch (error) {
      if (this.stopped) return
      const current = this.current(taskId)
      if (current && !TERMINAL.has(current.status)) this.finishTask(current, 'failed', `The worker could not start: ${error instanceof Error ? error.message : String(error)}`.slice(0, 1000))
    }
  }

  private current(taskId: string): TaskRow | undefined {
    return this.db.prepare('SELECT * FROM work_tasks WHERE id = ?').get(taskId) as TaskRow | undefined
  }

  private watch(task: TaskRow): void {
    if (!task.thread_id || this.watches.has(task.id)) return
    const unsubscribe = this.host.subscribe(task.thread_id, () => this.evaluate(task.id))
    this.watches.set(task.id, unsubscribe)
  }

  private unwatch(taskId: string): void {
    this.watches.get(taskId)?.()
    this.watches.delete(taskId)
  }

  /** Reads the worker's state and moves the task accordingly. */
  evaluate(taskId: string, settle = false): void {
    if (this.stopped) return
    const task = this.current(taskId)
    if (!task || !task.thread_id || TERMINAL.has(task.status)) { this.unwatch(taskId); return }
    let snapshot: ThreadSnapshot
    try { snapshot = this.host.read(task.thread_id) } catch { this.finishTask(task, 'failed', 'The worker conversation was deleted'); return }
    const thread = snapshot.thread
    const mine = (snapshot.turns ?? []).slice(task.turn_base)
    const waiting = thread.status === 'approval' || snapshot.events.some(event => event.type === 'request' && event.request.state === 'pending')
    if (waiting) {
      if (task.status !== 'blocked') {
        this.db.prepare("UPDATE work_tasks SET status = 'blocked', reason = ? WHERE id = ?").run(NEEDS_INPUT, task.id)
        this.event(task.run_id, task.id, 'blocked', NEEDS_INPUT)
        this.note(task.run_id, `Task "${task.key}" is waiting for an answer in its worker conversation.`)
      }
      return
    }
    const last = mine.at(-1)
    const busy = thread.status === 'running' || last?.status === 'running' || (thread.queue?.length ?? 0) > 0 && !thread.queuePause
    if (busy || !last) {
      if (task.status === 'blocked' && task.reason === NEEDS_INPUT) this.db.prepare("UPDATE work_tasks SET status = 'running', reason = NULL WHERE id = ?").run(task.id)
      if (!last && settle && !this.launching.has(task.id)) this.finishTask(task, 'failed', 'OXESpace closed before the worker started its turn')
      return
    }
    const verdict = turnVerdict(snapshot, last.id)
    const files = new Set<string>()
    for (const turn of mine) for (const path of turnVerdict(snapshot, turn.id)?.filesChanged ?? []) files.add(path)
    // A failed turn has no verdict summary; the last thing the worker said still helps the supervisor.
    const closing = [...snapshot.events].reverse().find((event): event is Extract<typeof event, { type: 'message' }> => event.type === 'message' && event.role === 'assistant')
    const result: WorkTaskResult = {
      summary: (verdict?.summary || closing?.text || '').slice(0, MAX_SUMMARY),
      verdict: verdict?.status ?? (last.status === 'completed' ? 'completed' : last.status),
      filesChanged: [...files].slice(0, 200),
      toolCalls: verdict?.toolCalls ?? 0,
      failedToolCalls: verdict?.failedToolCalls ?? 0,
      ...(verdict?.failure ? { failure: verdict.failure } : {})
    }
    if (last.status === 'completed') this.finishTask(task, 'succeeded', undefined, true, result)
    else this.finishTask(task, 'failed', last.status === 'interrupted' ? 'The worker turn was stopped' : result.failure?.message ?? 'The worker turn failed', true, result)
  }

  private finishTask(task: TaskRow, status: 'succeeded' | 'failed' | 'cancelled', reason?: string, settleRun = true, result?: WorkTaskResult): void {
    // A worker that settles while OXESpace closes is settled on the next start instead.
    if (this.stopped) return
    const changed = this.db.prepare(`UPDATE work_tasks SET status = ?, reason = ?, finished_at = ?, result_json = COALESCE(?, result_json) WHERE id = ? AND status NOT IN ('succeeded', 'failed', 'cancelled')`)
      .run(status, reason ?? null, Date.now(), result ? JSON.stringify(result) : null, task.id).changes
    if (!changed) return
    this.unwatch(task.id)
    this.event(task.run_id, task.id, status, reason ?? (result?.summary.slice(0, 300) || task.title))
    if (status === 'failed') this.note(task.run_id, `Task "${task.key}" failed: ${reason ?? 'no reason reported'}.`)
    if (!settleRun) return
    this.checkBudget(task.run_id)
    this.settleRun(task.run_id)
    this.schedule()
  }

  private checkBudget(runId: string): void {
    const run = this.db.prepare('SELECT * FROM work_runs WHERE id = ?').get(runId) as RunRow | undefined
    if (!run || run.status !== 'running' || (run.budget_usd === null && run.budget_turns === null)) return
    const spent = this.spent(run)
    const over = run.budget_usd !== null && spent.usd >= run.budget_usd ? `US$ ${spent.usd.toFixed(2)} of US$ ${run.budget_usd}`
      : run.budget_turns !== null && spent.turns >= run.budget_turns ? `${spent.turns} of ${run.budget_turns} turns` : ''
    if (!over) return
    const open = (this.db.prepare('SELECT * FROM work_tasks WHERE run_id = ?').all(runId) as TaskRow[]).filter(task => !TERMINAL.has(task.status))
    if (!open.length) return
    const running = open.filter(task => task.thread_id && (task.status === 'running' || task.status === 'blocked'))
    for (const task of open) this.finishTask(task, 'cancelled', `Budget reached (${over})`, false)
    for (const task of running) void this.host.interrupt(task.thread_id!).catch(() => {})
    this.db.prepare("UPDATE work_runs SET status = 'blocked', updated_at = ? WHERE id = ?").run(Date.now(), runId)
    this.event(runId, undefined, 'budget', `Budget reached (${over}); ${open.length} unfinished ${open.length === 1 ? 'task was' : 'tasks were'} stopped`)
    this.note(runId, `The run stopped at its budget (${over}). Unfinished tasks were cancelled; plan new work with a larger budget to continue.`)
  }

  private settleRun(runId: string, quiet = false): void {
    const run = this.db.prepare('SELECT * FROM work_runs WHERE id = ?').get(runId) as RunRow | undefined
    if (!run || run.status !== 'running') return
    const tasks = this.db.prepare('SELECT * FROM work_tasks WHERE run_id = ? ORDER BY position').all(runId) as TaskRow[]
    if (tasks.some(task => !TERMINAL.has(task.status))) return
    const status: WorkRunStatus = tasks.some(task => task.status === 'failed') ? 'failed' : tasks.some(task => task.status === 'cancelled') ? 'cancelled' : 'succeeded'
    this.db.prepare('UPDATE work_runs SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), runId)
    this.event(runId, undefined, 'finished', status)
    if (quiet) return
    const lines = tasks.map(task => `- ${task.key} (${task.status})${task.reason ? `: ${task.reason}` : ''}`)
    this.note(runId, `The run "${run.title}" ${status === 'succeeded' ? 'finished: every task succeeded' : `ended as ${status}`}.\n${lines.join('\n')}\nRead each result with oxespace_work_result before reporting back.`)
  }

  /** Queues a note for the supervisor; notes close together arrive as one message. */
  private note(runId: string, message: string): void {
    const list = this.notes.get(runId) ?? []
    list.push(message)
    this.notes.set(runId, list)
    if (this.wakeTimers.has(runId) || this.stopped) return
    const timer = setTimeout(() => { this.wakeTimers.delete(runId); void this.flush(runId) }, this.limits.wakeDelayMs)
    timer.unref?.()
    this.wakeTimers.set(runId, timer)
  }

  private async flush(runId: string): Promise<void> {
    const messages = this.notes.get(runId) ?? []
    this.notes.delete(runId)
    if (!messages.length || this.stopped) return
    const run = this.db.prepare('SELECT * FROM work_runs WHERE id = ?').get(runId) as RunRow | undefined
    if (!run) return
    if (!run.auto_wake) { this.event(runId, undefined, 'note', messages.join('\n')); return }
    if (run.wakes >= this.limits.wakesPerRun) { this.event(runId, undefined, 'note', `Not delivered (wake limit reached): ${messages.join(' ')}`); return }
    this.db.prepare('UPDATE work_runs SET wakes = wakes + 1 WHERE id = ?').run(runId)
    const body = `[OXESpace Agent Work · run ${run.id} · "${run.title}"]\n${messages.join('\n')}\nUse oxespace_work_status for the whole run.`
    try { await this.host.send(run.supervisor_thread_id, body) }
    catch (error) { this.event(runId, undefined, 'note', `Could not reach the supervisor (${error instanceof Error ? error.message : 'unknown error'}): ${messages.join(' ')}`) }
  }
}
