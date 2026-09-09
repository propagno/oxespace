import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import type { AppDatabase } from '../db'
import type { DelegationInput, DelegationTask, DelegationEvent, DelegationState } from '../../../shared/types/delegation'
import type { GitHubWorktreeApi } from '../../../shared/types/github'
import type { WorkspaceService } from './workspace.service'
import type { AgentExecution, ExecutionRegistry } from './execution-registry'
import { projectIdentity } from './memory/memory-project.service'

const exec = promisify(execFile)
const terminalStates = new Set<DelegationState>(['cancelled', 'approved'])
export interface DelegationDependencies {
  workspace: WorkspaceService; git: GitHubWorktreeApi; executions: ExecutionRegistry
  launch(task: DelegationTask): Promise<void>
  stop(paneId: string): void
  changed(workspaceId: string, taskId: string): void
  enrich?(task: DelegationTask): Promise<string>
  validateAgent(id: string): void
}
export class DelegationService {
  ownsPane(paneId: string): boolean { return this.all().some(t => t.paneId === paneId) }
  private pending = new Map<string, Promise<void>>()
  private locks = new Map<string, Promise<void>>()
  private closing = false
  constructor(private db: AppDatabase, private deps: DelegationDependencies) {
    // A fresh application has no surviving managed PTYs. Never replay work on boot.
    for (const task of this.all()) if (['preparing', 'starting', 'accepted', 'blocked'].includes(task.state)) {
      task.state = 'interrupted'; task.error = 'Application restarted. Inspect the preserved worktree before retrying.'; this.save(task)
    }
  }
  private all(): DelegationTask[] { return (this.db.prepare('SELECT payload FROM delegations').all() as { payload: string }[]).map(row => JSON.parse(row.payload)) }
  get(id: string): DelegationTask {
    const row = this.db.prepare('SELECT payload FROM delegations WHERE id = ?').get(id) as { payload: string } | undefined
    if (!row) throw new Error('Delegation not found')
    return JSON.parse(row.payload)
  }
  private save(task: DelegationTask): void {
    task.updatedAt = Date.now()
    this.db.prepare('INSERT INTO delegations(id,origin_execution,request_key,workspace_id,payload) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload')
      .run(task.id, task.originExecutionId, task.key, task.workspaceId, JSON.stringify(task))
  }
  private event(task: DelegationTask, kind: string, text: string): void {
    this.db.prepare('INSERT INTO delegation_events(task_id,kind,text,created_at) VALUES(?,?,?,?)').run(task.id, kind, text, Date.now())
    this.deps.changed(task.workspaceId, task.id)
  }
  async status(workspaceId: string) {
    const ws = this.deps.workspace.get(workspaceId)
    if (!ws) throw new Error('Workspace not found')
    const project = await projectIdentity(ws.rootPath)
    return { enabled: this.enabled(project), tasks: this.all().filter(t => t.workspaceId === workspaceId).sort((a,b) => b.createdAt-a.createdAt) }
  }
  private enabled(project: string): boolean {
    return !!(this.db.prepare('SELECT enabled FROM delegation_settings WHERE project=?').get(project) as { enabled: number } | undefined)?.enabled
  }
  async configure(workspaceId: string, enabled: boolean): Promise<void> {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean')
    const ws = this.deps.workspace.get(workspaceId)
    if (!ws) throw new Error('Workspace not found')
    const project = await projectIdentity(ws.rootPath)
    this.db.prepare('INSERT INTO delegation_settings(project,enabled) VALUES(?,?) ON CONFLICT(project) DO UPDATE SET enabled=excluded.enabled').run(project, Number(enabled))
  }
  async create(origin: AgentExecution, input: DelegationInput): Promise<DelegationTask> {
    for (const field of ['key','agentProfileId','objective','handoff','acceptance'] as const) {
      if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > (field === 'handoff' ? 16000 : 2000)) throw new Error(`Invalid ${field}`)
    }
    const project = await projectIdentity(origin.cwd)
    if (!this.enabled(project)) throw new Error('Enable Agent delegation in Workspace settings first')
    if (this.all().some(t => t.paneId === origin.paneId)) throw new Error('Recursive delegation is disabled')
    this.deps.validateAgent(input.agentProfileId)
    const baseSha = await this.git(origin.cwd, ['rev-parse', '--verify', 'HEAD^{commit}'])
    const localChanges = (await this.git(origin.cwd, ['status', '--short'])).slice(0,8000)
    // Do not derive checkout paths from .git: separate git dirs and submodules
    // may place it outside the checkout, or inside another repository's metadata.
    const mainWorktree = (await this.git(origin.cwd, ['worktree', 'list', '--porcelain'])).split('\n')[0].replace(/^worktree /, '')
    if (!mainWorktree) throw new Error('Cannot locate the primary worktree')
    // Recheck after awaits: concurrent identical requests must converge.
    const existing = this.all().find(t => t.originExecutionId === origin.id && t.key === input.key)
    if (existing) {
      for (const field of ['agentProfileId','objective','handoff','acceptance'] as const) if (existing[field] !== input[field]) throw new Error('Idempotency key already used with different input')
      return existing
    }
    if (this.all().filter(t => t.project === project && !['approved','cancelled','failed','interrupted','review'].includes(t.state)).length >= 4) throw new Error('This project already has four active delegations')
    const id = randomUUID()
    const slug = input.objective.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0,32) || 'task'
    const branch = `oxe/${slug}-${id.slice(0,8)}`
    const task: DelegationTask = { ...input, id, workspaceId: origin.workspaceId, originPaneId: origin.paneId, originExecutionId: origin.id,
      project, cwd: origin.cwd, branch, path: join(dirname(mainWorktree), `${basename(mainWorktree)}-worktrees`, `${slug}-${id.slice(0,8)}`),
      baseSha, localChanges, state: 'preparing', createdAt: Date.now(), updatedAt: Date.now() }
    this.save(task); this.event(task, 'created', 'Delegation queued')
    this.schedule(task.id)
    return task
  }
  private schedule(id: string): void {
    if (this.pending.has(id) || this.closing) return
    const task = this.get(id)
    const prior = this.locks.get(task.project) ?? Promise.resolve()
    const next = prior.catch(() => {}).then(() => this.provision(id)).finally(() => {
      this.pending.delete(id)
      if (this.locks.get(task.project) === next) this.locks.delete(task.project)
    })
    this.pending.set(id, next); this.locks.set(task.project, next)
  }
  private active(id: string): DelegationTask {
    const t = this.get(id)
    if (this.closing || terminalStates.has(t.state)) throw new Error('Delegation cancelled')
    if (!this.enabled(t.project)) throw new Error('Agent delegation has been disabled')
    return t
  }
  private async git(cwd: string, args: string[]): Promise<string> {
    return (await exec('git', args, { cwd, windowsHide: true, timeout: 15000, maxBuffer: 128 * 1024 })).stdout.trim()
  }
  private async provision(id: string): Promise<void> {
    try {
      let t = this.active(id)
      if (await projectIdentity(t.cwd) !== t.project) throw new Error('Origin checkout identity changed')
      if (!t.baseSha) {
        const sha = await this.git(t.cwd, ['rev-parse', '--verify', 'HEAD^{commit}'])
        const changes = await this.git(t.cwd, ['status', '--short'])
        t = this.active(id); t.baseSha = sha; t.localChanges = changes.slice(0,8000); this.save(t)
      }
      if (!existsSync(t.path)) {
        const branches = await this.git(t.cwd, ['branch', '--list', t.branch])
        await this.deps.git.createWorktree({ rootPath: t.cwd, path: t.path, branch: t.branch, createBranch: !branches, baseRef: t.baseSha, fetchBase: false })
      }
      t = this.active(id)
      if (await projectIdentity(t.path) !== t.project || await this.git(t.path, ['branch','--show-current']) !== t.branch) throw new Error('Destination worktree does not match delegation')
      t = this.active(id)
      if (!t.paneId) {
        // Synchronous DB operations: no renderer can launch a partially configured pane.
        this.db.transaction(() => {
          t.paneId = this.deps.workspace.createPane(t.workspaceId).paneId
          this.deps.workspace.setPaneRootPath(t.paneId, t.path)
          this.deps.workspace.setPaneAgent(t.paneId, t.agentProfileId, 'Delegated agent')
          this.deps.workspace.updatePaneName(t.paneId, t.objective.slice(0,80))
          this.save(t)
        })()
      }
      if (!t.context) {
        let extra = ''
        if (this.deps.enrich) {
          let timer: ReturnType<typeof setTimeout> | undefined
          try { extra = await Promise.race([this.deps.enrich(t), new Promise<string>(resolve => { timer = setTimeout(() => resolve('Optional context timed out.'), 5000) })]) }
          catch { extra = 'Optional memory/code context unavailable.' }
          finally { clearTimeout(timer) }
        }
        t = this.active(id)
        t.context = `Task: ${t.objective}\nAcceptance: ${t.acceptance}\nBase commit: ${t.baseSha}\nCheckout: ${t.path}\n\nOrigin handoff (verify claims):\n${t.handoff}\n\nUncommitted origin files NOT copied:\n${t.localChanges || 'None'}\n\nHistorical/code evidence:\n${extra.slice(0,10000)}`
        this.save(t)
      }
      t = this.active(id); t.state = 'starting'; t.error = undefined; this.save(t)
      await this.deps.launch(t)
      t = this.active(id)
      t.destinationExecutionId = this.deps.executions.forPane(t.paneId!)?.id
      if (!t.destinationExecutionId) throw new Error('Agent execution registration failed')
      this.save(t); this.event(t, 'starting', 'Terminal started. Awaiting agent acceptance; open it if login or trust is required.')
    } catch (error) {
      const t = this.get(id)
      if (t.state === 'cancelled') { if (t.paneId) this.deps.stop(t.paneId); return }
      t.state = this.closing ? 'interrupted' : 'failed'; t.error = error instanceof Error ? error.message : 'Provisioning failed'
      this.save(t); this.event(t, 'failed', t.error)
    }
  }
  async authorize(execution: AgentExecution, id: string): Promise<DelegationTask> {
    const project = await projectIdentity(execution.cwd)
    const t = this.get(id)
    if (execution.workspaceId !== t.workspaceId || project !== t.project) throw new Error('Delegation is outside this execution scope')
    if (t.state === 'starting' && t.paneId === execution.paneId && !t.destinationExecutionId) {
      t.destinationExecutionId = execution.id; this.save(t)
    }
    if (execution.id !== t.originExecutionId && execution.id !== t.destinationExecutionId) throw new Error('Delegation is outside this execution scope')
    return t
  }
  async update(execution: AgentExecution, id: string, state: string, text: string): Promise<void> {
    const t = await this.authorize(execution, id)
    if (execution.id !== t.destinationExecutionId || !['starting','accepted','blocked'].includes(t.state)) throw new Error('Only the active delegated execution can report progress')
    if (!['accepted','blocked','review'].includes(state)) throw new Error('Expected accepted, blocked or review')
    if (!text?.trim() || text.length > 12000) throw new Error('Provide a bounded progress/result summary')
    t.state = state as DelegationState; t.lastReport = text; this.save(t); this.event(t, state, text)
  }
  async message(execution: AgentExecution, id: string, text: string): Promise<void> {
    const t = await this.authorize(execution,id)
    if (!text?.trim() || text.length > 12000) throw new Error('Provide a bounded message')
    t.lastMessage = text; this.save(t)
    this.event(t, execution.id === t.originExecutionId ? 'origin-message' : 'agent-message', text)
  }
  inbox(execution: AgentExecution, after = 0): DelegationEvent[] {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid cursor')
    return this.db.prepare(`SELECT e.cursor, e.task_id AS taskId, e.kind, e.text, e.created_at AS createdAt
      FROM delegation_events e JOIN delegations d ON d.id=e.task_id
      WHERE e.cursor > ? AND d.workspace_id=?
      AND (d.origin_execution=? OR json_extract(d.payload, '$.destinationExecutionId')=?)
      ORDER BY e.cursor LIMIT 50`).all(after, execution.workspaceId, execution.id, execution.id) as DelegationEvent[]
  }
  async control(workspaceId: string, id: string, action: string): Promise<void> {
    const t = this.get(id)
    if (t.workspaceId !== workspaceId) throw new Error('Wrong workspace')
    if (action === 'cancel') {
      if (t.state === 'approved') throw new Error('Task already approved')
      t.state = 'cancelled'; this.save(t)
      if (t.paneId) this.deps.stop(t.paneId)
    } else if (action === 'approve') {
      if (t.state !== 'review') throw new Error('Task has no result awaiting review')
      t.state = 'approved'; this.save(t)
    } else if (action === 'retry') {
      if (!['failed','interrupted'].includes(t.state) || this.pending.has(id)) throw new Error('Task is not ready for retry')
      if (!this.enabled(t.project)) throw new Error('Enable Agent delegation before retrying')
      if (this.all().filter(other => other.project === t.project && ['preparing','starting','accepted','blocked'].includes(other.state)).length >= 4) throw new Error('This project already has four active delegations')
      if (t.paneId) this.deps.stop(t.paneId)
      t.state = 'preparing'; t.destinationExecutionId = undefined; this.save(t); this.schedule(id)
    } else throw new Error('Unknown control action')
    this.event(t, action, action === 'cancel' ? 'Cancelled. Worktree and code preserved.' : action)
  }
  exited(paneId: string): void {
    for (const t of this.all()) if (t.paneId === paneId && ['starting','accepted','blocked'].includes(t.state)) {
      t.state = 'interrupted'; this.save(t); this.event(t,'interrupted','Agent process exited without a submitted result.')
    }
  }
  async stop(): Promise<void> { this.closing = true; await Promise.allSettled(this.pending.values()) }
}
