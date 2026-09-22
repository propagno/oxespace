import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import type { ConversationThread } from '../../../../shared/types/thread'
import type { AppDatabase } from '../../db'
import type { DelegationInput, DelegationTask, DelegationEvent, DelegationState } from '../../../../shared/types/delegation'
import type { GitHubWorktreeApi } from '../../../../shared/types/github'
import type { WorkspaceService } from '../workspace.service'
import type { AgentExecution, ExecutionRegistry } from '../execution-registry'
import { projectIdentity } from '../memory/memory-project.service'
import { TaskCoordinator } from '../coordination/coordinator'
import { collectEvidence } from '../coordination/evidence-bundle'
import { DelegationRepository } from './delegation.repository'
import { DelegationGitPlanner } from './delegation-git-planner'
import { DelegationGitProvisioner } from './delegation-git-provisioner'
import { KnowledgeTransferService, type DelegationEnrichment } from './knowledge-transfer.service'
import { captureDelegationSessions } from './delegation-session-context'
import type { ThreadDelegationHost } from './thread-delegation-host'

const exec = promisify(execFile)
const terminalStates = new Set<DelegationState>(['cancelled', 'approved'])
export interface DelegationDependencies {
  workspace: WorkspaceService; git: GitHubWorktreeApi; executions: ExecutionRegistry
  launch(task: DelegationTask): Promise<void>
  stop(paneId: string): void
  changed(workspaceId: string, taskId: string): void
  enrich?(task: DelegationTask): Promise<string | DelegationEnrichment>
  validateAgent(id: string): void
  threadHost?: ThreadDelegationHost
}
export class DelegationApplicationService {
  readonly coordinator: TaskCoordinator
  private readonly repository: DelegationRepository
  private readonly gitPlanner: DelegationGitPlanner
  private readonly gitProvisioner: DelegationGitProvisioner
  private readonly knowledge = new KnowledgeTransferService()
  async capabilities(execution: AgentExecution) {
    const project = await projectIdentity(execution.cwd)
    const child = this.repository.forExecution(execution.id).find(task => task.destinationExecutionId === execution.id || task.paneId === execution.paneId)
    const activeCount = this.repository.activeCount(project)
    const enabled = this.enabled(project)
    return { enabled, role: child ? 'executor' : 'origin', canDelegate: enabled && !child && activeCount < 4,
      activeCount, limit: 4, taskId: child?.id ?? null,
      reason: !enabled ? 'PROJECT_OPT_IN_REQUIRED' : child ? 'RECURSIVE_DELEGATION_DISABLED' : activeCount >= 4 ? 'CONCURRENCY_LIMIT' : null }
  }
  ownsPane(paneId: string): boolean { return Boolean(this.repository.forPane(paneId)) }
  private pending = new Map<string, Promise<void>>()
  private recoveries = new Map<string, Promise<void>>()
  private locks = new Map<string, Promise<void>>()
  private closing = false
  private previews = new Map<string, { workspaceId: string; objective: string; intent: string; baseSha: string; branch: string; path: string; expires: number }>()
  constructor(private db: AppDatabase, private deps: DelegationDependencies) {
    this.repository = new DelegationRepository(db)
    this.gitPlanner = new DelegationGitPlanner(deps.git, (cwd, args) => this.git(cwd, args))
    this.gitProvisioner = new DelegationGitProvisioner(deps.git, this.repository, (cwd, args) => this.git(cwd, args))
    this.coordinator = new TaskCoordinator(db, deps.workspace, deps.executions)
    this.repository.settleRunningUnknown('OXESpace restarted before the operation result was confirmed.')
    // A fresh application has no surviving managed PTYs. Never replay work on boot.
    for (const task of this.all()) if (['preparing', 'starting', 'accepted', 'blocked'].includes(task.state)) {
      task.state = 'interrupted'; task.error = 'Application restarted. Inspect the preserved worktree before retrying.'; this.save(task)
    }
    for (const row of this.db.prepare("SELECT c.data_json FROM conversation_threads c JOIN delegations d ON json_extract(d.payload, '$.destinationThreadId') = c.id").all() as { data_json: string }[]) this.observeThread(JSON.parse(row.data_json))
  }
  private all(): DelegationTask[] { return this.repository.all() }
  get(id: string): DelegationTask {
    const task = this.repository.get(id)
    if (!task) throw new Error('Delegation not found')
    return task
  }
  private save(task: DelegationTask): void { this.repository.save(task) }
  observeThread(thread: ConversationThread): void {
    const row = this.db.prepare("SELECT id FROM delegations WHERE json_extract(payload, '$.destinationThreadId') = ? LIMIT 1").get(thread.id) as { id: string } | undefined
    if (!row) return
    const task = this.get(row.id)
    const canonical = (value: string) => process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value)
    if (canonical(task.path) !== canonical(thread.rootPath) || task.workspaceId !== thread.workspaceId) return
    let changed = false
    if (thread.nativeSessionId && !task.nativeSession) {
      task.nativeSession = { provider: thread.provider, nativeSessionId: thread.nativeSessionId, canonicalRoot: task.path, generation: 1, observedAt: Date.now(), resumable: true }
      changed = true
    }
    if (['starting', 'accepted', 'blocked'].includes(task.state) && ['failed', 'interrupted'].includes(thread.status)) {
      task.state = 'interrupted'; task.error = 'The delegated conversation stopped. Open it to inspect the error or resume its exact session.'; changed = true
    }
    if (changed) { this.save(task); this.event(task, 'session-observed', 'Native conversation binding updated') }
  }
  private event(task: DelegationTask, kind: string, text: string): void {
    this.db.prepare('INSERT INTO delegation_events(task_id,kind,text,created_at) VALUES(?,?,?,?)').run(task.id, kind, text, Date.now())
    this.deps.changed(task.workspaceId, task.id)
    if (task.originWorkspaceId && task.originWorkspaceId !== task.workspaceId) this.deps.changed(task.originWorkspaceId, task.id)
  }
  async status(workspaceId: string, cursor?: string, limit = 100) {
    const ws = this.deps.workspace.get(workspaceId)
    if (!ws) throw new Error('Workspace not found')
    const project = await projectIdentity(ws.rootPath)
    const page = this.repository.byWorkspace(workspaceId, limit, cursor)
    return { enabled: this.enabled(project), targets: this.coordinator.targets(project), tasks: page.tasks, nextCursor: page.nextCursor }
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
  async preview(workspaceId: string, objective: string, branchIntent?: DelegationInput['branchIntent']) {
    if (typeof objective !== 'string' || !objective.trim() || objective.length > 2000) throw new Error('Invalid objective')
    const target = this.deps.workspace.get(workspaceId)
    if (!target) throw new Error('Target workspace not found')
    const project = await projectIdentity(target.rootPath)
    const previewId = randomUUID()
    const checkout = await this.gitPlanner.plan({ rootPath: target.rootPath, objective: objective.trim(), taskId: previewId, branchIntent })
    for (const [id, preview] of this.previews) if (preview.expires < Date.now()) this.previews.delete(id)
    if (this.previews.size >= 100) this.previews.delete(this.previews.keys().next().value!)
    this.previews.set(previewId, { workspaceId, objective: objective.trim(), intent: JSON.stringify(branchIntent ?? { strategy: 'generated' }), baseSha: checkout.baseSha, branch: checkout.branch, path: checkout.path, expires: Date.now() + 300000 })
    return { previewId, targetWorkspaceId: workspaceId, targetName: target.name, checkout, ready: this.enabled(project),
      reason: this.enabled(project) ? null : 'PROJECT_OPT_IN_REQUIRED', effects: [
        checkout.reuseExistingWorktree ? 'Reuse selected destination worktree' : 'Create isolated destination worktree',
        'Start an independent persistent Thread', 'Persist handoff, operation journal and native session binding'
      ] }
  }
  async create(origin: AgentExecution, input: DelegationInput): Promise<DelegationTask> {
    origin = this.deps.executions.authenticate(origin.id, origin.token, origin.workspaceId)
    for (const field of ['key','agentProfileId','objective','handoff','acceptance'] as const) {
      if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > (field === 'handoff' ? 16000 : 2000)) throw new Error(`Invalid ${field}`)
    }
    if (input.mode !== undefined && !['analysis','isolated-change'].includes(input.mode)) throw new Error('Invalid execution mode')
    if (input.schemaVersion !== undefined && input.schemaVersion !== 2) throw new Error('Invalid delegation schema version')
    if (input.surface !== undefined && !['thread','terminal'].includes(input.surface)) throw new Error('Invalid delegation surface')
    if (input.branchIntent !== undefined && (!input.branchIntent || typeof input.branchIntent !== 'object' || !['existing','create','generated'].includes(input.branchIntent.strategy))) throw new Error('Invalid branch intent')
    if (input.evidenceFiles !== undefined && (!Array.isArray(input.evidenceFiles) || input.evidenceFiles.length > 8 || input.evidenceFiles.some(path => typeof path !== 'string' || !path || path.length > 512))) throw new Error('Invalid evidence selection')
    if (input.sourceThreadIds !== undefined && (!Array.isArray(input.sourceThreadIds) || input.sourceThreadIds.length > 5 || new Set(input.sourceThreadIds).size !== input.sourceThreadIds.length || input.sourceThreadIds.some(id => typeof id !== 'string' || !/^[a-f\d-]{36}$/i.test(id)))) throw new Error('Select up to five distinct conversations')
    if (input.includeMemory !== undefined && typeof input.includeMemory !== 'boolean') throw new Error('Invalid AI Memory selection')
    if (input.targetWorkspaceId !== undefined && (typeof input.targetWorkspaceId !== 'string' || !input.targetWorkspaceId || input.targetWorkspaceId.length > 128)) throw new Error('Invalid target workspace')
    const originProject = await projectIdentity(origin.cwd)
    const targetId = input.targetWorkspaceId ?? origin.workspaceId
    const target = this.deps.workspace.get(targetId)
    if (!target) throw new Error('Target workspace not found')
    const cwd = targetId === origin.workspaceId ? origin.cwd : target.rootPath
    const project = await projectIdentity(cwd)
    this.coordinator.requireRoute(originProject, targetId, project, !!input.evidenceFiles?.length)
    if (!this.enabled(originProject) || !this.enabled(project)) throw new Error('Enable Agent delegation in both source and destination Workspace settings first')
    if (this.repository.forExecution(origin.id).some(t => t.paneId === origin.paneId || t.destinationExecutionId === origin.id)) throw new Error('Recursive delegation is disabled')
    this.deps.validateAgent(input.agentProfileId)
    const localChanges = (await this.git(cwd, ['status', '--short'])).slice(0,8000)
    // Recheck after awaits: concurrent identical requests must converge.
    const normalized = { schemaVersion: 2 as const, key: input.key, agentProfileId: input.agentProfileId, objective: input.objective, handoff: input.handoff, acceptance: input.acceptance,
      targetWorkspaceId: targetId, mode: input.mode ?? 'isolated-change', surface: input.surface ?? (this.deps.threadHost ? 'thread' : 'terminal'),
      branchIntent: input.branchIntent ?? { strategy: 'generated' as const }, evidenceFiles: input.evidenceFiles ?? [],
      ...(input.sourceThreadIds?.length ? { sourceThreadIds: input.sourceThreadIds } : {}),
      ...(input.includeMemory !== undefined ? { includeMemory: input.includeMemory } : {}) }
    const payloadHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
    const request = this.db.prepare('SELECT task_id AS id, payload_hash AS hash FROM coordination_requests WHERE origin_pane=? AND request_key=?')
      .get(origin.paneId, input.key) as { id: string; hash: string } | undefined
    const existing = request ? this.get(request.id) : this.all().find(t => t.originExecutionId === origin.id && t.key === input.key)
    if (existing) {
      const legacyHash = createHash('sha256').update(JSON.stringify({ key: input.key, agentProfileId: input.agentProfileId,
        objective: input.objective, handoff: input.handoff, acceptance: input.acceptance, targetWorkspaceId: targetId,
        mode: input.mode ?? 'isolated-change', evidenceFiles: input.evidenceFiles ?? [] })).digest('hex')
      const legacyCompatible = !existing.schemaVersion && !input.schemaVersion && !input.branchIntent && !input.surface && request?.hash === legacyHash
      if (request && request.hash !== payloadHash && !legacyCompatible) throw new Error('Idempotency key already used with different input')
      for (const field of ['agentProfileId','objective','handoff','acceptance'] as const) if (existing[field] !== input[field]) throw new Error('Idempotency key already used with different input')
      if (existing.originExecutionId !== origin.id) throw new Error('TASK_ADOPTION_REQUIRED: ask the user to reconnect this task in Workspace settings')
      return existing
    }
    const sessionContext = input.sourceThreadIds?.length ? await captureDelegationSessions(this.db, input.sourceThreadIds, originProject) : []
    const evidence = input.evidenceFiles?.length ? await collectEvidence(origin.cwd, input.evidenceFiles) : []
    // Evidence reading can yield; serialize the final creation through the durable key.
    const concurrent = this.db.prepare('SELECT task_id AS id, payload_hash AS hash FROM coordination_requests WHERE origin_pane=? AND request_key=?').get(origin.paneId, input.key) as { id: string; hash: string } | undefined
    if (concurrent) {
      if (concurrent.hash !== payloadHash) throw new Error('Idempotency key already used with different input')
      return this.get(concurrent.id)
    }
    this.deps.executions.authenticate(origin.id, origin.token, origin.workspaceId)
    this.coordinator.requireRoute(originProject, targetId, project, !!evidence.length)
    if (this.repository.activeCount() >= 12) throw new Error('Global delegation limit reached (12)')
    if (this.repository.activeCount(project) >= 4) throw new Error('This project already has four active delegations')
    let id = randomUUID()
    if (input.previewId !== undefined) {
      const preview = typeof input.previewId === 'string' ? this.previews.get(input.previewId) : undefined
      if (!preview || preview.expires < Date.now() || preview.workspaceId !== targetId || preview.objective !== input.objective.trim() || preview.intent !== JSON.stringify(normalized.branchIntent)) throw new Error('CHECKOUT_PREVIEW_EXPIRED: preview the checkout again')
      id = input.previewId as `${string}-${string}-${string}-${string}-${string}`
    }
    const checkout = await this.gitPlanner.plan({ rootPath: cwd, objective: input.objective, taskId: id, branchIntent: normalized.branchIntent })
    const preview = input.previewId ? this.previews.get(input.previewId) : undefined
    if (preview && (preview.baseSha !== checkout.baseSha || preview.branch !== checkout.branch || preview.path !== checkout.path)) throw new Error('CHECKOUT_PREVIEW_CHANGED: preview the checkout again')
    // Revalidate after Git inspection: a caller cannot keep an expired lease
    // alive by holding preflight work open.
    this.deps.executions.authenticate(origin.id, origin.token, origin.workspaceId)
    this.coordinator.requireRoute(originProject, targetId, project, !!evidence.length)
    const afterPlan = this.db.prepare('SELECT task_id AS id, payload_hash AS hash FROM coordination_requests WHERE origin_pane=? AND request_key=?')
      .get(origin.paneId, input.key) as { id: string; hash: string } | undefined
    if (afterPlan) {
      if (afterPlan.hash !== payloadHash) throw new Error('Idempotency key already used with different input')
      return this.get(afterPlan.id)
    }
    if (this.repository.activeCount() >= 12) throw new Error('Global delegation limit reached (12)')
    if (this.repository.activeCount(project) >= 4) throw new Error('This project already has four active delegations')
    if (this.db.prepare("SELECT task_id FROM delegation_task_index WHERE project = ? AND branch = ? AND state NOT IN ('approved', 'cancelled') LIMIT 1").get(project, checkout.branch)) throw new Error('BRANCH_OWNED_BY_DELEGATION: open the existing task instead')
    const task: DelegationTask = { ...normalized, id, workspaceId: targetId, originPaneId: origin.paneId, originExecutionId: origin.id,
      originWorkspaceId: origin.workspaceId, originProjectId: originProject, originCwd: origin.cwd, evidence, sessionContext,
      project, cwd, branch: checkout.branch, path: checkout.path, checkout,
      baseSha: checkout.baseSha, localChanges, state: 'preparing', createdAt: Date.now(), updatedAt: Date.now() }
    this.db.transaction(() => {
      this.save(task); this.coordinator.initialize(task)
      this.db.prepare('INSERT INTO coordination_requests VALUES (?, ?, ?, ?)').run(origin.paneId, input.key, payloadHash, id)
      this.coordinator.receipt(id, 'queued')
    })()
    try { await this.coordinator.bind(task, 'requester', origin) }
    catch (error) {
      task.state = 'failed'; task.error = 'Origin authorization expired before launch. Reconnect the task from settings.'
      this.save(task); this.event(task, 'failed', task.error); throw error
    }
    this.event(task, 'created', 'Delegation queued')
    this.schedule(task.id)
    return task
  }
  async createFromSurface(workspaceId: string, owner: { kind: 'pane' | 'thread'; id: string }, input: DelegationInput): Promise<DelegationTask> {
    if (!owner || !['pane', 'thread'].includes(owner.kind) || typeof owner.id !== 'string' || !owner.id || owner.id.length > 128) throw new Error('Invalid delegation origin')
    const workspace = this.deps.workspace.get(workspaceId)
    if (!workspace) throw new Error('Origin workspace not found')
    let execution = this.deps.executions.forOwner(owner)
    if (owner.kind === 'thread') {
      if (!this.deps.threadHost) throw new Error('Thread delegation unavailable')
      const origin = await this.deps.threadHost.origin(owner.id, workspaceId)
      execution = this.deps.executions.forOwner(owner)
      if (!execution) {
        this.deps.executions.register({ owner, workspaceId, cwd: origin.cwd })
        execution = this.deps.executions.forOwner(owner)
      }
    } else if (!workspace.panes.some(pane => pane.id === owner.id)) throw new Error('Origin terminal belongs to another workspace')
    if (!execution || execution.workspaceId !== workspaceId) throw new Error('Start the origin agent before delegating')
    return this.create(execution, input)
  }
  private schedule(id: string): void {
    if (this.pending.has(id) || this.closing) return
    const task = this.get(id)
    const lockKey = `${task.project}:${task.branch}`
    const prior = this.locks.get(lockKey) ?? Promise.resolve()
    const next = prior.catch(() => {}).then(() => this.provision(id)).finally(() => {
      this.pending.delete(id)
      if (this.locks.get(lockKey) === next) this.locks.delete(lockKey)
    })
    this.pending.set(id, next); this.locks.set(lockKey, next)
  }
  private active(id: string): DelegationTask {
    const t = this.get(id)
    if (this.closing || terminalStates.has(t.state)) throw new Error('Delegation cancelled')
    if (!this.enabled(t.project)) throw new Error('Agent delegation has been disabled')
    if (t.originProjectId && !this.enabled(t.originProjectId)) throw new Error('Origin delegation has been disabled')
    this.coordinator.checkTask(t)
    return t
  }
  private stopOwned(task: DelegationTask): void {
    if (task.surface === 'thread' && this.deps.threadHost) {
      void this.deps.threadHost.stop(task).catch(() => {})
      return
    }
    if (!task.paneId) return
    const execution = this.deps.executions.forPane(task.paneId)
    if (execution && execution.id === task.destinationExecutionId) this.deps.stop(task.paneId)
  }
  private async git(cwd: string, args: string[]): Promise<string> {
    return (await exec('git', args, { cwd, windowsHide: true, timeout: 15000, maxBuffer: 128 * 1024 })).stdout.trim()
  }
  private async provision(id: string): Promise<void> {
    try {
      let t = this.active(id)
      if (await projectIdentity(t.cwd) !== t.project) throw new Error('Origin checkout identity changed')
      if (t.originCwd && await projectIdentity(t.originCwd) !== t.originProjectId) throw new Error('Source checkout identity changed')
      if (!t.checkout) {
        // Lazy upgrade for v1 tasks persisted before migration 57.
        t.checkout = { strategy: t.branchIntent?.strategy ?? 'generated', branch: t.branch, baseRef: t.baseSha,
          baseSha: t.baseSha, path: t.path, createBranch: true, reuseExistingWorktree: false, fetchBase: false, resolvedAt: t.createdAt }
        this.save(t)
      }
      await this.gitProvisioner.apply(t, () => { this.active(id) })
      t = this.active(id)
      this.coordinator.receipt(id, 'worktree-verified')
      t = this.active(id)
      const workspace = this.deps.workspace.get(t.workspaceId)
      if (!workspace) throw new Error('Workspace not found')
      if (t.surface !== 'thread' && (!t.paneId || !workspace.panes.some(pane => pane.id === t.paneId))) {
        // Synchronous DB operations: no renderer can launch a partially configured pane.
        this.db.transaction(() => {
          t.paneId = this.deps.workspace.createPane(t.workspaceId).paneId
          this.deps.workspace.setPaneRootPath(t.paneId, t.path)
          this.deps.workspace.setPaneAgent(t.paneId, t.agentProfileId, 'Delegated agent')
          this.deps.workspace.updatePaneName(t.paneId, t.objective.slice(0,80))
          this.save(t)
        })()
      }
      if (t.surface !== 'thread') this.coordinator.receipt(id, 'pane-prepared')
      if (!t.context) {
        let extra: string | DelegationEnrichment = ''
        if (this.deps.enrich) {
          let timer: ReturnType<typeof setTimeout> | undefined
          try { extra = await Promise.race([this.deps.enrich(t), new Promise<DelegationEnrichment>(resolve => { timer = setTimeout(() => resolve({}), 5000) })]) }
          catch { extra = {} }
          finally { clearTimeout(timer) }
        }
        t = this.active(id)
        t.knowledgeBundle = this.knowledge.build(t, extra)
        t.context = t.knowledgeBundle.context
        this.save(t)
      }
      t = this.active(id); t.state = 'starting'; t.error = undefined; this.save(t)
      this.coordinator.receipt(id, 'launch-requested')
      const launchGeneration = (t.nativeSession?.generation ?? 0) + 1
      this.repository.journal(id, 'provider-start', launchGeneration, 'running')
      if (t.surface === 'thread' && this.deps.threadHost) {
        const result = await this.deps.threadHost.start(t, threadId => {
          t.destinationThreadId = threadId
          this.save(t)
          this.coordinator.receipt(id, 'thread-created')
        })
        t = this.get(id)
        t.destinationThreadId = result.threadId
        t.destinationExecutionId = result.executionId
        t.nativeSession = { provider: result.provider, nativeSessionId: result.nativeSessionId,
          canonicalRoot: t.path, generation: launchGeneration, observedAt: Date.now(), resumable: true }
        this.save(t)
        t = this.active(id)
        const execution = this.deps.executions.forOwner({ kind: 'thread', id: result.threadId })
        if (!execution) throw new Error('Thread execution registration failed')
        if (t.originWorkspaceId) await this.coordinator.bind(t, 'executor', execution)
        this.repository.journal(id, 'provider-start', launchGeneration, 'succeeded', { threadId: result.threadId,
          provider: result.provider, nativeSessionId: result.nativeSessionId, canonicalRoot: t.path })
        this.coordinator.receipt(id, 'execution-registered')
        this.event(t, 'starting', 'Thread started and bound to its native provider session.')
        return
      }
      await this.deps.launch(t)
      // Capture the launched execution before checking cancellation so a
      // cancellation during start can stop that process, not an unrelated one.
      t = this.get(id)
      t.destinationExecutionId = this.deps.executions.forPane(t.paneId!)?.id
      if (!t.destinationExecutionId) throw new Error('Agent execution registration failed')
      this.save(t)
      t = this.active(id)
      if (t.originWorkspaceId) await this.coordinator.bind(t, 'executor', this.deps.executions.forPane(t.paneId!)!)
      this.repository.journal(id, 'provider-start', launchGeneration, 'succeeded', { paneId: t.paneId, executionId: t.destinationExecutionId })
      this.coordinator.receipt(id, 'execution-registered')
      this.save(t); this.event(t, 'starting', 'Terminal started. Awaiting agent acceptance; open it if login or trust is required.')
    } catch (error) {
      const t = this.get(id)
      if (t.state === 'cancelled') { this.stopOwned(t); return }
      const launchWasRequested = t.state === 'starting'
      t.state = this.closing ? 'interrupted' : 'failed'; t.error = error instanceof Error ? error.message : 'Provisioning failed'
      if (launchWasRequested) this.repository.journal(id, 'provider-start', (t.nativeSession?.generation ?? 0) + 1, 'failed', undefined, t.error)
      this.save(t); this.event(t, 'failed', t.error)
    }
  }
  async authorize(execution: AgentExecution, id: string): Promise<DelegationTask> {
    try { execution = this.deps.executions.authenticate(execution.id, execution.token, execution.workspaceId) }
    catch { throw new Error('Delegation is outside this execution scope: live execution required') }
    const project = await projectIdentity(execution.cwd)
    const t = this.get(id)
    const isOrigin = execution.id === t.originExecutionId
    if (execution.workspaceId !== (isOrigin ? t.originWorkspaceId ?? t.workspaceId : t.workspaceId) || project !== (isOrigin ? t.originProjectId ?? t.project : t.project)) throw new Error('Delegation is outside this execution scope')
    const expectedDestination = t.paneId === execution.paneId ||
      (t.destinationThreadId !== undefined && execution.owner.kind === 'thread' && execution.owner.id === t.destinationThreadId)
    if (t.state === 'starting' && expectedDestination && !t.destinationExecutionId) {
      t.destinationExecutionId = execution.id; this.save(t)
      if (t.originWorkspaceId) await this.coordinator.bind(t, 'executor', execution)
    }
    if (execution.id !== t.originExecutionId && execution.id !== t.destinationExecutionId) throw new Error('Delegation is outside this execution scope')
    if (t.originWorkspaceId) await this.coordinator.authorize(t, execution, 'read')
    return t
  }
  async update(execution: AgentExecution, id: string, state: string, text: string): Promise<void> {
    let t = await this.authorize(execution, id)
    if (t.originWorkspaceId) await this.coordinator.authorize(t, execution, 'report')
    t = this.get(id)
    if (execution.id !== t.destinationExecutionId || !['starting','accepted','blocked'].includes(t.state)) throw new Error('Only the active delegated execution can report progress')
    if (!['accepted','blocked','review'].includes(state)) throw new Error('Expected accepted, blocked or review')
    if (!text?.trim() || text.length > 12000) throw new Error('Provide a bounded progress/result summary')
    this.db.transaction(() => {
      t.state = state as DelegationState; t.lastReport = text; this.save(t)
      if (state === 'review') this.coordinator.result(t.id, text)
      this.event(t, state, text)
    })()
  }
  async message(execution: AgentExecution, id: string, text: string): Promise<void> {
    let t = await this.authorize(execution,id)
    if (t.originWorkspaceId) await this.coordinator.authorize(t, execution, 'message')
    t = this.get(id)
    if (!text?.trim() || text.length > 12000) throw new Error('Provide a bounded message')
    t.lastMessage = text; this.save(t)
    this.event(t, execution.id === t.originExecutionId ? 'origin-message' : 'agent-message', text)
  }
  async checkpoint(execution: AgentExecution, id: string, text: string): Promise<void> {
    let task = await this.authorize(execution, id)
    if (task.originWorkspaceId) await this.coordinator.authorize(task, execution, 'report')
    task = this.get(id)
    if (execution.id !== task.destinationExecutionId || !['starting', 'accepted', 'blocked'].includes(task.state)) throw new Error('Only the active delegated execution can checkpoint progress')
    if (!text?.trim() || Buffer.byteLength(text) > 12000) throw new Error('Provide a bounded checkpoint summary')
    this.db.transaction(() => {
      task.lastReport = text.trim()
      task.knowledgeBundle = this.knowledge.build(task, task.context ?? '')
      task.context = task.knowledgeBundle.context
      this.save(task); this.event(task, 'checkpoint', text.trim())
    })()
  }
  async inbox(execution: AgentExecution, after?: number): Promise<DelegationEvent[]> {
    if (after !== undefined && (!Number.isSafeInteger(after) || after < 0)) throw new Error('Invalid cursor')
    this.deps.executions.authenticate(execution.id, execution.token, execution.workspaceId)
    const permitted: string[] = []
    const cursors = new Map<string, number>()
    for (const task of this.repository.forExecution(execution.id)) {
      const role = task.originExecutionId === execution.id ? 'requester' : 'executor'
      cursors.set(task.id, this.coordinator.cursor(task, role))
      try { await this.authorize(execution, task.id); permitted.push(task.id) }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/COORDINATION_ACCESS_DENIED|CROSS_PROJECT_CONSENT_REQUIRED|outside this execution scope/.test(message)) {
          throw new Error('DELEGATION_INBOX_UNAVAILABLE: could not verify project identity; retry when Git is available')
        }
      }
    }
    return (this.db.prepare(`SELECT e.cursor, e.task_id AS taskId, e.kind, e.text, e.created_at AS createdAt
      FROM delegation_events e JOIN delegations d ON d.id=e.task_id
      WHERE e.cursor > ?
      AND (d.origin_execution=? OR json_extract(d.payload, '$.destinationExecutionId')=?)
      ORDER BY e.cursor`).all(after ?? 0, execution.id, execution.id) as DelegationEvent[])
      .filter(event => permitted.includes(event.taskId) && (after !== undefined || event.cursor > (cursors.get(event.taskId) ?? 0))).slice(0,50)
  }
  async control(workspaceId: string, id: string, action: string): Promise<void> {
    if (!['resume', 'new-session'].includes(action)) return this.controlTask(workspaceId, id, action)
    if (this.recoveries.has(id) || this.pending.has(id)) throw new Error('Recovery is already in progress')
    const operation = this.controlTask(workspaceId, id, action)
    this.recoveries.set(id, operation)
    try { await operation } finally { this.recoveries.delete(id) }
  }
  private async controlTask(workspaceId: string, id: string, action: string): Promise<void> {
    let t = this.get(id)
    if ((t.originWorkspaceId ?? t.workspaceId) !== workspaceId) throw new Error('Only the origin workspace can control this task')
    if (action === 'cancel') {
      if (t.state === 'approved') throw new Error('Task already approved')
      t.state = 'cancelled'; this.save(t)
      this.stopOwned(t)
    } else if (action === 'approve') {
      if (t.state !== 'review') throw new Error('Task has no result awaiting review')
      t.state = 'approved'; this.save(t)
    } else if (action === 'retry') {
      if (!['failed','interrupted'].includes(t.state) || this.pending.has(id)) throw new Error('Task is not ready for retry')
      if (t.nativeSession?.resumable) throw new Error('A native session is available. Use Resume to continue it; Retry is only for provisioning failures.')
      if (!this.enabled(t.project)) throw new Error('Enable Agent delegation before retrying')
      this.coordinator.checkTask(t)
      if (this.repository.activeCount(t.project) >= 4) throw new Error('This project already has four active delegations')
      if (this.repository.activeCount() >= 12) throw new Error('Global delegation limit reached (12)')
      if (t.paneId) {
        const current = this.deps.executions.forPane(t.paneId)
        if (current && current.id !== t.destinationExecutionId) throw new Error('Destination terminal belongs to another execution. Close it before retrying.')
        this.stopOwned(t)
      }
      t.state = 'preparing'; t.destinationExecutionId = undefined; this.save(t); this.schedule(id)
    } else if (action === 'new-session') {
      if (!['failed', 'interrupted'].includes(t.state) || this.pending.has(id)) throw new Error('Task is not ready for a new session')
      this.active(id)
      if (this.repository.activeCount() >= 12 || this.repository.activeCount(t.project) >= 4) throw new Error('Delegation concurrency limit reached')
      if (t.destinationThreadId && this.deps.threadHost) await this.deps.threadHost.stop(t)
      t = this.active(id)
      this.repository.journal(id, 'session-replaced', Date.now(), 'succeeded', { threadId: t.destinationThreadId, nativeSession: t.nativeSession })
      t.destinationThreadId = undefined; t.destinationExecutionId = undefined; t.nativeSession = undefined
      const bundle = this.knowledge.build(t, `Previous confirmed context:\n${t.context ?? t.handoff}\nLatest checkpoint:\n${t.lastReport ?? 'None'}\nLatest message:\n${t.lastMessage ?? 'None'}`)
      bundle.revision = (t.knowledgeBundle?.revision ?? 0) + 1
      t.knowledgeBundle = bundle; t.context = bundle.context
      t.state = 'preparing'; t.error = undefined
      this.save(t); this.schedule(id)
    } else if (action === 'resume') {
      if (!['failed','interrupted'].includes(t.state) || this.pending.has(id)) throw new Error('Task is not ready to resume')
      if (!this.deps.threadHost || t.surface !== 'thread' || !t.nativeSession?.resumable) throw new Error('This task has no resumable native Thread session')
      if (!this.enabled(t.project) || (t.originProjectId && !this.enabled(t.originProjectId))) throw new Error('Enable Agent delegation before resuming')
      this.coordinator.checkTask(t)
      const resumeGeneration = t.nativeSession.generation + 1
      if (this.repository.activeCount() >= 12 || this.repository.activeCount(t.project) >= 4) throw new Error('Delegation concurrency limit reached')
      t.state = 'starting'; t.error = undefined; t.destinationExecutionId = undefined; this.save(t)
      this.repository.journal(id, 'provider-resume', resumeGeneration, 'running')
      try {
        await this.gitProvisioner.apply(t, () => { this.active(id) })
        t = this.active(id)
        const result = await this.deps.threadHost.resume(t)
        t = this.get(id)
        t.destinationExecutionId = result.executionId
        t.nativeSession = { provider: result.provider, nativeSessionId: result.nativeSessionId, canonicalRoot: t.path, resumable: true, generation: resumeGeneration, observedAt: Date.now() }
        this.save(t)
        t = this.active(id)
        const execution = this.deps.executions.forOwner({ kind: 'thread', id: result.threadId })
        if (!execution) throw new Error('Thread execution registration failed')
        if (t.originWorkspaceId) await this.coordinator.bind(t, 'executor', execution)
        this.repository.journal(id, 'provider-resume', resumeGeneration, 'succeeded', { threadId: result.threadId,
          nativeSessionId: result.nativeSessionId, canonicalRoot: t.path })
      } catch (error) {
        t = this.get(id)
        if (t.state === 'cancelled' || this.closing) { this.stopOwned(t); return }
        t.state = 'failed'; t.error = error instanceof Error ? error.message : 'Resume failed'; this.save(t)
        this.repository.journal(id, 'provider-resume', resumeGeneration, 'failed', undefined, t.error); throw error
      }
    } else if (action === 'open' || action === 'continue') {
      if (!t.destinationThreadId && !t.paneId) throw new Error('Delegation has no destination to open')
    } else throw new Error('Unknown control action')
    this.event(t, action, action === 'cancel' ? 'Cancelled. Worktree and code preserved.' : action)
  }
  async configureTarget(workspaceId: string, path: string, enabled: boolean, evidence: boolean): Promise<void> {
    await this.coordinator.configureTarget(workspaceId, path, enabled, evidence)
    this.deps.changed(workspaceId, '')
  }
  async preflight(execution: AgentExecution, options?: string | { targetWorkspaceId?: string; objective?: string; branchIntent?: DelegationInput['branchIntent'] }) {
    const origin = this.deps.executions.authenticate(execution.id, execution.token, execution.workspaceId)
    const originProject = await projectIdentity(origin.cwd)
    const targetWorkspaceId = typeof options === 'string' ? options : options?.targetWorkspaceId
    const id = targetWorkspaceId ?? origin.workspaceId
    if (typeof id !== 'string' || !id || id.length > 128) throw new Error('Invalid target workspace')
    // Do not probe arbitrary foreign paths for an unapproved caller.
    if (id !== origin.workspaceId && !this.coordinator.targets(originProject).some(t => t.workspaceId === id)) throw new Error('CROSS_PROJECT_CONSENT_REQUIRED')
    const target = this.deps.workspace.get(id)
    if (!target) throw new Error('Target workspace not found')
    const cwd = id === origin.workspaceId ? origin.cwd : target.rootPath
    const project = await projectIdentity(cwd)
    this.coordinator.requireRoute(originProject, id, project, false)
    const checkout = await this.gitPlanner.plan({ rootPath: cwd, objective: typeof options === 'object' ? options.objective?.trim() || 'delegated-task' : 'delegated-task',
      taskId: 'preview0', branchIntent: typeof options === 'object' ? options.branchIntent : undefined })
    this.deps.executions.authenticate(origin.id, origin.token, origin.workspaceId)
    this.coordinator.requireRoute(originProject, id, project, false)
    return { targetWorkspaceId: id, targetName: target.name, baseSha: checkout.baseSha, checkout,
      ready: this.enabled(originProject) && this.enabled(project),
      reason: !this.enabled(originProject) || !this.enabled(project) ? 'PROJECT_OPT_IN_REQUIRED' : null,
      effects: [checkout.reuseExistingWorktree ? 'reuse selected destination worktree' : 'create isolated destination worktree',
        'start independent agent session', 'persist local task, handoff and recovery binding'],
      limits: { projectActiveTasks: 4, globalActiveTasks: 12, evidenceBytes: 64000, evidenceFiles: 8 },
      automaticWakeUp: false, analysisIsSandboxed: false }
  }
  async adopt(workspaceId: string, taskId: string, paneId: string): Promise<void> {
    let task = this.get(taskId)
    if ((task.originWorkspaceId ?? task.workspaceId) !== workspaceId) throw new Error('Only the origin can reconnect a task')
    const owner = paneId.startsWith('thread:') ? { kind: 'thread' as const, id: paneId.slice(7) } : { kind: 'pane' as const, id: paneId }
    if (owner.kind === 'thread') {
      if (!this.deps.threadHost) throw new Error('Thread delegation unavailable')
      const source = await this.deps.threadHost.origin(owner.id, workspaceId)
      if (!this.deps.executions.forOwner(owner)) this.deps.executions.register({ owner, workspaceId, cwd: source.cwd })
      if (this.db.prepare("SELECT id FROM delegations WHERE json_extract(payload, '$.destinationThreadId') = ? LIMIT 1").get(owner.id)) throw new Error('A delegated executor cannot adopt an origin role')
    }
    const execution = this.deps.executions.forOwner(owner)
    if (!execution || execution.workspaceId !== workspaceId) throw new Error('Select a running agent in the origin workspace')
    if (this.ownsPane(paneId)) throw new Error('A delegated executor cannot adopt an origin role')
    const requests = this.db.prepare('SELECT request_key, payload_hash FROM coordination_requests WHERE task_id=?')
      .all(taskId) as { request_key: string; payload_hash: string }[]
    const checkRequestAliases = () => {
      for (const request of requests) {
        const existing = this.db.prepare('SELECT task_id FROM coordination_requests WHERE origin_pane=? AND request_key=?')
          .get(paneId, request.request_key) as { task_id: string } | undefined
        if (existing && existing.task_id !== taskId) throw new Error('This terminal already uses the request key for another task; choose another terminal')
      }
    }
    checkRequestAliases()
    const project = await projectIdentity(execution.cwd)
    if (project !== (task.originProjectId ?? task.project)) throw new Error('Wrong project')
    this.coordinator.checkTask(task)
    this.coordinator.initialize(task, ['requester'])
    await this.coordinator.bind(task, 'requester', execution)
    task = this.get(taskId)
    task.originExecutionId = execution.id
    this.db.transaction(() => {
      checkRequestAliases()
      for (const request of requests) this.db.prepare('INSERT OR IGNORE INTO coordination_requests VALUES (?, ?, ?, ?)')
        .run(paneId, request.request_key, request.payload_hash, taskId)
      this.save(task); this.event(task, 'adopted', 'Origin reconnected with explicit user consent')
    })()
  }
  async details(execution: AgentExecution, id: string) {
    const task = await this.authorize(execution, id)
    return { task, operationId: id, receipts: this.coordinator.receipts(id), results: this.coordinator.results(id),
      checkpoints: this.db.prepare("SELECT cursor, text, created_at AS createdAt FROM delegation_events WHERE task_id = ? AND kind = 'checkpoint' ORDER BY cursor DESC LIMIT 50").all(id),
      operations: this.db.prepare('SELECT operation, generation, state, receipt_json AS receipt, error, started_at AS startedAt, finished_at AS finishedAt FROM delegation_operation_journal WHERE task_id = ? ORDER BY started_at DESC LIMIT 50').all(id),
      cursor: this.coordinator.cursor(task, execution.id === task.originExecutionId ? 'requester' : 'executor') }
  }
  exited(paneId: string): void {
    const task = this.repository.forPane(paneId)
    for (const t of task ? [task] : []) if (['starting','accepted','blocked'].includes(t.state)) {
      t.state = 'interrupted'; this.save(t); this.event(t,'interrupted','Agent process exited without a submitted result.')
    }
  }
  async stop(): Promise<void> { this.closing = true; await Promise.allSettled([...this.pending.values(), ...this.recoveries.values()]) }
}
