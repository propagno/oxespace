import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../db/index'
import type { AgentProvider } from '../../../shared/types/agent'
import type {
  AgentRole,
  AgentWorkflowArtifact,
  AgentWorkflowRun,
  AgentWorkflowRunDetails,
  AgentWorkflowStep,
  AppendAgentWorkflowArtifactInput,
  CompleteManualAgentWorkflowStepInput,
  CreateAgentWorkflowRunInput,
  PrepareAgentWorkflowStepInput,
  RunAgentWorkflowStepInput,
  UpdateWorkspaceAgentRoleBindingsInput,
  WorkflowArtifactKind,
  WorkflowRunStatus,
  WorkflowSourceType,
  WorkflowStepStatus,
  WorkspaceAgentRoleBinding
} from '../../../shared/types/agent-workflow'

interface AgentWorkflowServiceOptions {
  terminalWrite?: (input: { paneId: string; data: string }) => void | Promise<void>
}

interface BindingRow {
  workspace_id: string
  role: string
  agent_profile_id: string | null
  shell_profile_id: string | null
  model: string | null
  enabled: number
}

interface AgentRow {
  agent_profile_id: string
  provider: string
  name: string
  model: string | null
}

interface RunRow {
  id: string
  workspace_id: string
  source_type: string
  source_id: string | null
  title: string
  status: string
  created_at: number
  updated_at: number
}

interface StepRow {
  id: string
  run_id: string
  role: string
  agent_profile_id: string | null
  shell_profile_id: string | null
  status: string
  prompt: string
  output: string
  error: string | null
  started_at: number | null
  completed_at: number | null
}

interface ArtifactRow {
  id: string
  run_id: string
  step_id: string | null
  kind: string
  title: string
  content: string
  created_at: number
}

const ROLE_ORDER: AgentRole[] = ['rubber_duck', 'planner', 'executor', 'reviewer', 'verifier', 'publisher']
const ROLE_STATUS: Record<AgentRole, WorkflowRunStatus> = {
  rubber_duck: 'clarifying',
  planner: 'planned',
  executor: 'executing',
  reviewer: 'reviewing',
  verifier: 'verifying',
  publisher: 'ready_to_publish'
}

const ROLE_ARTIFACT_KIND: Record<AgentRole, WorkflowArtifactKind> = {
  rubber_duck: 'question_set',
  planner: 'plan',
  executor: 'execution_notes',
  reviewer: 'review',
  verifier: 'verification',
  publisher: 'publish_notes'
}

const ROLE_LABEL: Record<AgentRole, string> = {
  rubber_duck: 'Rubber Duck',
  planner: 'Planner',
  executor: 'Executor',
  reviewer: 'Reviewer',
  verifier: 'Verifier',
  publisher: 'Publisher'
}

export class AgentWorkflowService {
  private readonly terminalWrite: (input: { paneId: string; data: string }) => void | Promise<void>

  constructor(private readonly db: AppDatabase, options: AgentWorkflowServiceOptions = {}) {
    this.terminalWrite = options.terminalWrite ?? (() => undefined)
  }

  listRuns(workspaceId: string): AgentWorkflowRun[] {
    this.ensureDefaultBindings(workspaceId)
    const rows = this.db
      .prepare('SELECT * FROM agent_workflow_runs WHERE workspace_id = ? ORDER BY updated_at DESC')
      .all(workspaceId) as RunRow[]
    return rows.map(mapRun)
  }

  createRun(input: CreateAgentWorkflowRunInput): AgentWorkflowRunDetails {
    this.ensureWorkspace(input.workspaceId)
    const bindings = this.ensureDefaultBindings(input.workspaceId)
    const runId = randomUUID()
    const now = Date.now()
    const sourceType = input.sourceType ?? 'manual'
    const initialPrompt = input.initialPrompt?.trim() ?? ''

    const create = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO agent_workflow_runs (id, workspace_id, source_type, source_id, title, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)
      `).run(runId, input.workspaceId, sourceType, input.sourceId ?? null, input.title, now, now)

      const insertStep = this.db.prepare(`
        INSERT INTO agent_workflow_steps
          (id, run_id, role, agent_profile_id, shell_profile_id, status, prompt, output, error, started_at, completed_at)
        VALUES
          (?, ?, ?, ?, ?, 'pending', '', '', NULL, NULL, NULL)
      `)
      for (const role of ROLE_ORDER) {
        const binding = bindings.find((item) => item.role === role)
        insertStep.run(randomUUID(), runId, role, binding?.agentProfileId ?? null, binding?.shellProfileId ?? null)
      }

      if (initialPrompt) {
        this.db.prepare(`
          INSERT INTO agent_workflow_artifacts (id, run_id, step_id, kind, title, content, created_at)
          VALUES (?, ?, NULL, 'clarification', 'Initial input', ?, ?)
        `).run(randomUUID(), runId, initialPrompt, now)
      }
    })
    create()

    return this.getRun(runId)
  }

  getRun(runId: string): AgentWorkflowRunDetails {
    const run = this.getRunOrThrow(runId)
    return {
      run,
      steps: this.listSteps(runId),
      artifacts: this.listArtifacts(runId)
    }
  }

  getRoleBindings(workspaceId: string): WorkspaceAgentRoleBinding[] {
    return this.ensureDefaultBindings(workspaceId)
  }

  updateRoleBindings(input: UpdateWorkspaceAgentRoleBindingsInput): WorkspaceAgentRoleBinding[] {
    this.ensureWorkspace(input.workspaceId)
    const now = Date.now()
    const update = this.db.transaction(() => {
      const upsert = this.db.prepare(`
        INSERT INTO workspace_agent_role_bindings
          (workspace_id, role, agent_profile_id, shell_profile_id, model, enabled, created_at, updated_at)
        VALUES
          (@workspaceId, @role, @agentProfileId, @shellProfileId, @model, @enabled, @createdAt, @updatedAt)
        ON CONFLICT(workspace_id, role) DO UPDATE SET
          agent_profile_id = excluded.agent_profile_id,
          shell_profile_id = excluded.shell_profile_id,
          model = excluded.model,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `)
      for (const binding of input.bindings) {
        upsert.run({
          workspaceId: input.workspaceId,
          role: binding.role,
          agentProfileId: binding.agentProfileId ?? null,
          shellProfileId: binding.shellProfileId ?? null,
          model: binding.model ?? null,
          enabled: binding.enabled === false ? 0 : 1,
          createdAt: now,
          updatedAt: now
        })
      }
    })
    update()
    return this.getBindings(input.workspaceId)
  }

  prepareStep(input: PrepareAgentWorkflowStepInput): AgentWorkflowRunDetails {
    const step = this.findStep(input.runId, input.role)
    if (!step) throw new Error(`Workflow step not found for role ${input.role}`)
    const run = this.getRunOrThrow(input.runId)
    const binding = this.getBinding(run.workspaceId, input.role)
    if (!binding?.enabled) throw new Error(`${ROLE_LABEL[input.role]} role is disabled`)

    const agent = binding.agentProfileId ? this.getAgent(binding.agentProfileId) : null
    const artifacts = this.listArtifacts(input.runId)
    const prompt = buildPrompt({
      role: input.role,
      run,
      provider: agent?.provider as AgentProvider | undefined,
      model: binding.model ?? agent?.model ?? null,
      artifacts
    })
    const now = Date.now()

    const prepare = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE agent_workflow_steps
        SET agent_profile_id = ?, shell_profile_id = ?, status = 'waiting_user', prompt = ?, output = '', error = NULL, started_at = NULL, completed_at = NULL
        WHERE id = ?
      `).run(binding.agentProfileId, binding.shellProfileId, prompt, step.id)
      this.db.prepare(`
        INSERT INTO agent_workflow_artifacts (id, run_id, step_id, kind, title, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), input.runId, step.id, ROLE_ARTIFACT_KIND[input.role], `${ROLE_LABEL[input.role]} prompt`, prompt, now)
      this.db.prepare('UPDATE agent_workflow_runs SET status = ?, updated_at = ? WHERE id = ?').run(ROLE_STATUS[input.role], now, input.runId)
    })
    prepare()

    return this.getRun(input.runId)
  }

  async runStep(input: RunAgentWorkflowStepInput): Promise<AgentWorkflowRunDetails> {
    const step = this.getStepOrThrow(input.stepId)
    if (step.prompt.trim() === '') throw new Error('Prepare the workflow step before running it')
    const startedAt = Date.now()
    this.db.prepare("UPDATE agent_workflow_steps SET status = 'running', started_at = ?, error = NULL WHERE id = ?").run(startedAt, input.stepId)

    try {
      await this.terminalWrite({ paneId: input.paneId, data: `${step.prompt}\r` })
      this.db.prepare("UPDATE agent_workflow_steps SET status = 'waiting_user', error = NULL WHERE id = ?").run(input.stepId)
    } catch (error) {
      this.db.prepare("UPDATE agent_workflow_steps SET status = 'failed', error = ?, completed_at = ? WHERE id = ?").run(toMessage(error), Date.now(), input.stepId)
    }

    return this.getRun(step.runId)
  }

  completeManualStep(input: CompleteManualAgentWorkflowStepInput): AgentWorkflowRunDetails {
    const step = this.getStepOrThrow(input.stepId)
    const status = input.status ?? 'passed'
    const now = Date.now()
    const complete = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE agent_workflow_steps
        SET status = ?, output = ?, error = NULL, completed_at = ?
        WHERE id = ?
      `).run(status, input.output, now, input.stepId)
      this.db.prepare(`
        INSERT INTO agent_workflow_artifacts (id, run_id, step_id, kind, title, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), step.runId, step.id, ROLE_ARTIFACT_KIND[step.role], `${ROLE_LABEL[step.role]} output`, input.output, now)
      this.updateRunStatusForCompletedStep(step.runId, step.role, status, now)
    })
    complete()
    return this.getRun(step.runId)
  }

  appendArtifact(input: AppendAgentWorkflowArtifactInput): AgentWorkflowRunDetails {
    const run = this.getRunOrThrow(input.runId)
    this.db.prepare(`
      INSERT INTO agent_workflow_artifacts (id, run_id, step_id, kind, title, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), input.runId, input.stepId ?? null, input.kind, input.title, input.content, Date.now())
    return this.getRun(run.id)
  }

  private updateRunStatusForCompletedStep(runId: string, role: AgentRole, status: WorkflowStepStatus, now: number): void {
    const nextStatus: WorkflowRunStatus =
      status === 'failed' ? 'failed' :
      status === 'blocked' ? 'blocked' :
      role === 'verifier' ? 'done' :
      role === 'publisher' ? 'done' :
      ROLE_STATUS[role]
    this.db.prepare('UPDATE agent_workflow_runs SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, now, runId)
  }

  private ensureDefaultBindings(workspaceId: string): WorkspaceAgentRoleBinding[] {
    this.ensureWorkspace(workspaceId)
    const existing = this.getBindings(workspaceId)
    if (existing.length === ROLE_ORDER.length) return existing

    const agents = this.listAgents()
    const now = Date.now()
    const defaults = ROLE_ORDER.map((role) => buildDefaultBinding(workspaceId, role, agents))
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO workspace_agent_role_bindings
        (workspace_id, role, agent_profile_id, shell_profile_id, model, enabled, created_at, updated_at)
      VALUES
        (@workspaceId, @role, @agentProfileId, @shellProfileId, @model, @enabled, @createdAt, @updatedAt)
    `)
    const createDefaults = this.db.transaction(() => {
      for (const binding of defaults) {
        insert.run({
          workspaceId,
          role: binding.role,
          agentProfileId: binding.agentProfileId,
          shellProfileId: binding.shellProfileId,
          model: binding.model ?? null,
          enabled: binding.enabled ? 1 : 0,
          createdAt: now,
          updatedAt: now
        })
      }
    })
    createDefaults()
    return this.getBindings(workspaceId)
  }

  private getBindings(workspaceId: string): WorkspaceAgentRoleBinding[] {
    const rows = this.db
      .prepare('SELECT * FROM workspace_agent_role_bindings WHERE workspace_id = ?')
      .all(workspaceId) as BindingRow[]
    return rows.map(mapBinding).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
  }

  private getBinding(workspaceId: string, role: AgentRole): WorkspaceAgentRoleBinding | null {
    const row = this.db
      .prepare('SELECT * FROM workspace_agent_role_bindings WHERE workspace_id = ? AND role = ?')
      .get(workspaceId, role) as BindingRow | undefined
    return row ? mapBinding(row) : null
  }

  private listAgents(): AgentRow[] {
    return this.db
      .prepare('SELECT agent_profile_id, provider, name, model FROM agent_profiles ORDER BY is_builtin DESC, name ASC')
      .all() as AgentRow[]
  }

  private getAgent(agentProfileId: string): AgentRow | null {
    const row = this.db
      .prepare('SELECT agent_profile_id, provider, name, model FROM agent_profiles WHERE agent_profile_id = ?')
      .get(agentProfileId) as AgentRow | undefined
    return row ?? null
  }

  private getRunOrThrow(runId: string): AgentWorkflowRun {
    const row = this.db.prepare('SELECT * FROM agent_workflow_runs WHERE id = ?').get(runId) as RunRow | undefined
    if (!row) throw new Error(`Workflow run not found: ${runId}`)
    return mapRun(row)
  }

  private listSteps(runId: string): AgentWorkflowStep[] {
    const rows = this.db.prepare('SELECT * FROM agent_workflow_steps WHERE run_id = ?').all(runId) as StepRow[]
    return rows.map(mapStep).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
  }

  private listArtifacts(runId: string): AgentWorkflowArtifact[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_workflow_artifacts WHERE run_id = ? ORDER BY created_at ASC')
      .all(runId) as ArtifactRow[]
    return rows.map(mapArtifact)
  }

  private findStep(runId: string, role: AgentRole): AgentWorkflowStep | null {
    const row = this.db
      .prepare('SELECT * FROM agent_workflow_steps WHERE run_id = ? AND role = ?')
      .get(runId, role) as StepRow | undefined
    return row ? mapStep(row) : null
  }

  private getStepOrThrow(stepId: string): AgentWorkflowStep {
    const row = this.db.prepare('SELECT * FROM agent_workflow_steps WHERE id = ?').get(stepId) as StepRow | undefined
    if (!row) throw new Error(`Workflow step not found: ${stepId}`)
    return mapStep(row)
  }

  private ensureWorkspace(workspaceId: string): void {
    const row = this.db.prepare('SELECT id FROM workspaces WHERE id = ?').get(workspaceId) as { id: string } | undefined
    if (!row) throw new Error(`Workspace ${workspaceId} not found`)
  }
}

function buildDefaultBinding(workspaceId: string, role: AgentRole, agents: AgentRow[]): WorkspaceAgentRoleBinding {
  const provider = preferredProvider(role, agents)
  const agent = provider ? agents.find((item) => item.provider === provider) : null
  return {
    workspaceId,
    role,
    agentProfileId: agent?.agent_profile_id ?? null,
    shellProfileId: provider === 'claude' ? 'builtin-claude' : provider === 'copilot' ? 'builtin-copilot' : null,
    model: agent?.model ?? undefined,
    enabled: role !== 'publisher'
  }
}

function preferredProvider(role: AgentRole, agents: AgentRow[]): AgentProvider | null {
  const has = (provider: AgentProvider): boolean => agents.some((item) => item.provider === provider)
  if (role === 'rubber_duck') return has('claude') ? 'claude' : has('copilot') ? 'copilot' : null
  if (role === 'planner') return has('claude') ? 'claude' : has('copilot') ? 'copilot' : null
  if (role === 'executor') return has('codex') ? 'codex' : has('copilot') ? 'copilot' : has('claude') ? 'claude' : null
  if (role === 'reviewer') return has('gemini') ? 'gemini' : has('claude') ? 'claude' : has('copilot') ? 'copilot' : null
  if (role === 'verifier') return null
  if (role === 'publisher') return has('copilot') ? 'copilot' : null
  return null
}

function buildPrompt(input: {
  role: AgentRole
  run: AgentWorkflowRun
  provider?: AgentProvider
  model: string | null
  artifacts: AgentWorkflowArtifact[]
}): string {
  const previous = input.artifacts
    .slice(-6)
    .map((artifact) => `## ${artifact.title}\n${artifact.content}`)
    .join('\n\n')
  const header = [
    `# ${ROLE_LABEL[input.role]} step for ${input.run.title}`,
    '',
    `Workspace workflow source: ${input.run.sourceType}${input.run.sourceId ? `:${input.run.sourceId}` : ''}`,
    input.provider ? `Agent provider: ${input.provider}` : 'Agent provider: manual/local',
    input.model ? `Model: ${input.model}` : ''
  ].filter(Boolean).join('\n')

  const instruction = roleInstruction(input.role)
  return [header, '', instruction, previous ? `\n# Existing context\n${previous}` : ''].join('\n').trim()
}

function roleInstruction(role: AgentRole): string {
  if (role === 'rubber_duck') {
    return [
      'You are the Rubber Duck for this local workflow.',
      'Ask concise blocking questions, separate facts from assumptions, and produce a clarification summary.',
      'Do not edit files. Do not run commands. Do not propose implementation until intent is clear.'
    ].join('\n')
  }
  if (role === 'planner') {
    return 'Create a decision-complete implementation plan with files, data flow, risks, rollback and verification. Do not edit files.'
  }
  if (role === 'executor') {
    return 'Implement only the approved plan. Keep the write set small, report changed files, and run the agreed checks.'
  }
  if (role === 'reviewer') {
    return 'Review the resulting changes. Lead with bugs, regressions, missing tests and risks. Do not edit files in this step.'
  }
  if (role === 'verifier') {
    return 'Verify the result against the plan and acceptance criteria. Report exact commands, outputs and residual risk.'
  }
  return 'Prepare publication notes for GitHub/PR handoff. Do not create branches or PRs unless a later publisher integration is enabled.'
}

function mapBinding(row: BindingRow): WorkspaceAgentRoleBinding {
  return {
    workspaceId: row.workspace_id,
    role: row.role as AgentRole,
    agentProfileId: row.agent_profile_id,
    shellProfileId: row.shell_profile_id,
    model: row.model ?? undefined,
    enabled: row.enabled === 1
  }
}

function mapRun(row: RunRow): AgentWorkflowRun {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sourceType: row.source_type as WorkflowSourceType,
    sourceId: row.source_id,
    title: row.title,
    status: row.status as WorkflowRunStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapStep(row: StepRow): AgentWorkflowStep {
  return {
    id: row.id,
    runId: row.run_id,
    role: row.role as AgentRole,
    agentProfileId: row.agent_profile_id,
    shellProfileId: row.shell_profile_id,
    status: row.status as WorkflowStepStatus,
    prompt: row.prompt,
    output: row.output,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at
  }
}

function mapArtifact(row: ArtifactRow): AgentWorkflowArtifact {
  return {
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id,
    kind: row.kind as WorkflowArtifactKind,
    title: row.title,
    content: row.content,
    createdAt: row.created_at
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Workflow step failed'
}
