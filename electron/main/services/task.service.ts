import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../db/index'
import type {
  CreateTaskInput,
  ReorderTasksInput,
  RunTaskInput,
  Task,
  TaskColumn,
  TaskExecution,
  TaskRunStatus,
  TaskVerifyOutputEvent,
  UpdateTaskInput,
  VerifyTaskInput
} from '../../../shared/types/task'

interface TaskServiceOptions {
  isTerminalRunning?: (paneId: string) => boolean
  terminalWrite?: (input: { paneId: string; data: string }) => void | Promise<void>
  emitVerifyOutput?: (event: TaskVerifyOutputEvent) => void
  spawnProcess?: typeof spawn
}

interface TaskRow {
  id: string
  workspace_id: string
  title: string
  description: string
  context: string
  acceptance_criteria: string
  verify_command: string
  allowed_files_json: string
  column_name: string
  run_status: string
  position: number
  created_at: number
  updated_at: number
}

interface TaskExecutionRow {
  id: string
  task_id: string
  type: string
  agent_profile_id: string | null
  prompt: string
  output: string
  exit_code: number | null
  started_at: number
  completed_at: number | null
}

interface WorkspaceRow {
  id: string
  root_path: string
}

interface PaneRow {
  id: string
  status: string
  agent_profile_id: string | null
}

interface AgentProfileRow {
  agent_profile_id: string
  command_template: string
}

const COLUMNS: TaskColumn[] = ['backlog', 'ready', 'running', 'review', 'done']
const STATUSES: TaskRunStatus[] = ['idle', 'running', 'verifying', 'passed', 'failed']
const MAX_STREAM_CHUNK = 500

export class TaskService {
  private readonly isTerminalRunning: (paneId: string) => boolean
  private readonly terminalWrite: (input: { paneId: string; data: string }) => void | Promise<void>
  private readonly emitVerifyOutput: (event: TaskVerifyOutputEvent) => void
  private readonly spawnProcess: typeof spawn

  constructor(private readonly db: AppDatabase, options: TaskServiceOptions = {}) {
    this.isTerminalRunning = options.isTerminalRunning ?? (() => false)
    this.terminalWrite = options.terminalWrite ?? (() => undefined)
    this.emitVerifyOutput = options.emitVerifyOutput ?? (() => undefined)
    this.spawnProcess = options.spawnProcess ?? spawn
  }

  list(workspaceId: string): Task[] {
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE workspace_id = ? ORDER BY column_name ASC, position ASC, created_at ASC')
      .all(workspaceId) as TaskRow[]
    const deps = this.loadDependenciesFor(workspaceId)
    return rows.map((row) => mapTask(row, deps.get(row.id) ?? []))
  }

  create(input: CreateTaskInput): Task {
    const now = Date.now()
    const column = input.column ?? 'backlog'
    const position = this.nextPosition(input.workspaceId, column)
    const id = randomUUID()

    this.db.prepare(`
      INSERT INTO tasks
        (id, workspace_id, title, description, context, acceptance_criteria, verify_command, allowed_files_json, column_name, run_status, position, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?, ?)
    `).run(
      id,
      input.workspaceId,
      input.title,
      input.description ?? '',
      input.context ?? '',
      input.acceptanceCriteria ?? '',
      input.verifyCommand ?? '',
      JSON.stringify(input.allowedFiles ?? []),
      column,
      position,
      now,
      now
    )

    return this.getOrThrow(id)
  }

  update(id: string, input: UpdateTaskInput): Task {
    const task = this.getOrThrow(id)
    const nextColumn = input.column ?? task.column
    const nextStatus = input.runStatus ?? task.runStatus
    if (!COLUMNS.includes(nextColumn)) throw new Error(`Invalid task column: ${nextColumn}`)
    if (!STATUSES.includes(nextStatus)) throw new Error(`Invalid task status: ${nextStatus}`)

    this.db.prepare(`
      UPDATE tasks
      SET title = ?, description = ?, context = ?, acceptance_criteria = ?, verify_command = ?, allowed_files_json = ?,
          column_name = ?, run_status = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.title ?? task.title,
      input.description ?? task.description,
      input.context ?? task.context,
      input.acceptanceCriteria ?? task.acceptanceCriteria,
      input.verifyCommand ?? task.verifyCommand,
      JSON.stringify(input.allowedFiles ?? task.allowedFiles),
      nextColumn,
      nextStatus,
      Date.now(),
      id
    )
    return this.getOrThrow(id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }

  reorder(input: ReorderTasksInput): Task[] {
    if (!COLUMNS.includes(input.column)) throw new Error(`Invalid task column: ${input.column}`)
    const updateMany = this.db.transaction(() => {
      const update = this.db.prepare(`
        UPDATE tasks
        SET column_name = ?, position = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ?
      `)
      const now = Date.now()
      input.orderedIds.forEach((id, position) => {
        update.run(input.column, position, now, id, input.workspaceId)
      })
    })
    updateMany()
    return this.list(input.workspaceId)
  }

  async run(input: RunTaskInput): Promise<Task> {
    const task = this.getOrThrow(input.taskId)
    const pane = input.paneId
      ? this.getRunningPane(task.workspaceId, input.paneId)
      : this.findRunningPane(task.workspaceId)
    if (!pane) throw new Error('Nenhum terminal ativo')

    const agent = this.getAgentProfile(input.agentProfileId ?? pane.agent_profile_id ?? undefined)
    if (!agent) throw new Error('Configure um agente primeiro')

    const promptPayload = buildPromptPayload(task)
    const prompt = agent.command_template.replace('{{task}}', promptPayload)
    await this.terminalWrite({ paneId: pane.id, data: `${prompt}\r` })

    const now = Date.now()
    this.db.prepare(`
      INSERT INTO task_executions
        (id, task_id, type, agent_profile_id, prompt, output, exit_code, started_at, completed_at)
      VALUES
        (?, ?, 'run', ?, ?, ?, NULL, ?, ?)
    `).run(randomUUID(), task.id, agent.agent_profile_id, prompt, `Prompt dispatched to terminal ${pane.id}. Verify the task when the agent finishes.`, now, now)

    this.db.prepare(`
      UPDATE tasks SET column_name = 'running', run_status = 'running', updated_at = ? WHERE id = ?
    `).run(now, task.id)
    return this.getOrThrow(task.id)
  }

  async verify(input: VerifyTaskInput): Promise<Task> {
    const task = this.getOrThrow(input.taskId)
    if (task.verifyCommand.trim() === '') throw new Error('Verify command is empty')

    const workspace = this.getWorkspace(task.workspaceId)
    const { file, args } = parseVerifyCommand(task.verifyCommand)
    const executionId = randomUUID()
    const startedAt = Date.now()
    let output = ''

    this.db.prepare(`
      INSERT INTO task_executions
        (id, task_id, type, agent_profile_id, prompt, output, exit_code, started_at, completed_at)
      VALUES
        (?, ?, 'verify', NULL, '', '', NULL, ?, NULL)
    `).run(executionId, task.id, startedAt)
    this.db.prepare("UPDATE tasks SET run_status = 'verifying', updated_at = ? WHERE id = ?").run(startedAt, task.id)

    let exitCode: number | null = null
    try {
      exitCode = await new Promise<number | null>((resolve, reject) => {
        const child = this.spawnProcess(file, args, {
          cwd: workspace.root_path,
          shell: false,
          windowsHide: true
        })

        const append = (chunk: Buffer | string): void => {
          const text = chunk.toString()
          output += text
          this.emitVerifyOutput({
            taskId: task.id,
            executionId,
            chunk: text.slice(0, MAX_STREAM_CHUNK),
            done: false
          })
        }

        child.stdout?.on('data', append)
        child.stderr?.on('data', append)
        child.on('error', reject)
        child.on('close', (code) => resolve(code))
      })
    } catch (error) {
      output += toMessage(error)
      exitCode = 1
    }

    const completedAt = Date.now()
    const passed = exitCode === 0
    this.db.prepare(`
      UPDATE task_executions
      SET output = ?, exit_code = ?, completed_at = ?
      WHERE id = ?
    `).run(output, exitCode, completedAt, executionId)
    this.db.prepare(`
      UPDATE tasks
      SET run_status = ?, column_name = ?, updated_at = ?
      WHERE id = ?
    `).run(passed ? 'passed' : 'failed', passed ? 'done' : 'review', completedAt, task.id)

    this.emitVerifyOutput({
      taskId: task.id,
      executionId,
      chunk: '',
      done: true,
      exitCode
    })

    return this.getOrThrow(task.id)
  }

  executions(taskId: string): TaskExecution[] {
    const rows = this.db
      .prepare('SELECT * FROM task_executions WHERE task_id = ? ORDER BY started_at DESC')
      .all(taskId) as TaskExecutionRow[]
    return rows.map(mapExecution)
  }

  private getOrThrow(id: string): Task {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
    if (!row) throw new Error(`Task not found: ${id}`)
    const deps = this.loadDependenciesForTask(id)
    return mapTask(row, deps)
  }

  private loadDependenciesForTask(taskId: string): string[] {
    const rows = this.db
      .prepare('SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?')
      .all(taskId) as Array<{ depends_on_task_id: string }>
    return rows.map((r) => r.depends_on_task_id)
  }

  private loadDependenciesFor(workspaceId: string): Map<string, string[]> {
    const rows = this.db
      .prepare(
        `SELECT td.task_id, td.depends_on_task_id
         FROM task_dependencies td
         JOIN tasks t ON t.id = td.task_id
         WHERE t.workspace_id = ?`
      )
      .all(workspaceId) as Array<{ task_id: string; depends_on_task_id: string }>
    const map = new Map<string, string[]>()
    for (const row of rows) {
      const existing = map.get(row.task_id) ?? []
      existing.push(row.depends_on_task_id)
      map.set(row.task_id, existing)
    }
    return map
  }

  /**
   * Adds a dependency edge from `taskId` to `dependsOnTaskId`. Rejects cycles by walking
   * the existing dependency graph forward from the proposed target.
   */
  addDependency(taskId: string, dependsOnTaskId: string): Task {
    if (taskId === dependsOnTaskId) throw new Error('Tarefa não pode depender de si mesma')
    const taskRow = this.db.prepare('SELECT workspace_id FROM tasks WHERE id = ?').get(taskId) as { workspace_id: string } | undefined
    const depRow = this.db.prepare('SELECT workspace_id FROM tasks WHERE id = ?').get(dependsOnTaskId) as { workspace_id: string } | undefined
    if (!taskRow) throw new Error(`Task ${taskId} not found`)
    if (!depRow) throw new Error(`Task ${dependsOnTaskId} not found`)
    if (taskRow.workspace_id !== depRow.workspace_id) {
      throw new Error('Dependências precisam estar no mesmo workspace')
    }
    if (this.wouldCreateCycle(taskId, dependsOnTaskId)) {
      throw new Error('Essa dependência criaria um ciclo')
    }
    this.db
      .prepare('INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)')
      .run(taskId, dependsOnTaskId)
    return this.getOrThrow(taskId)
  }

  removeDependency(taskId: string, dependsOnTaskId: string): Task {
    this.db
      .prepare('DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?')
      .run(taskId, dependsOnTaskId)
    return this.getOrThrow(taskId)
  }

  /** Returns ids of tasks where all dependencies are in `passed` runStatus. */
  getReadyTaskIds(workspaceId: string): string[] {
    const tasks = this.list(workspaceId)
    const byId = new Map(tasks.map((t) => [t.id, t]))
    const ready: string[] = []
    for (const task of tasks) {
      if (task.runStatus === 'running' || task.runStatus === 'verifying') continue
      if (task.runStatus === 'passed') continue
      if (task.column === 'done') continue
      const allDepsPassed = task.dependsOn.every((depId) => byId.get(depId)?.runStatus === 'passed')
      if (allDepsPassed) ready.push(task.id)
    }
    return ready
  }

  private wouldCreateCycle(taskId: string, newDependsOnTaskId: string): boolean {
    // BFS forward from newDependsOnTaskId: if we hit taskId, it's a cycle.
    const visited = new Set<string>()
    const stack: string[] = [newDependsOnTaskId]
    while (stack.length > 0) {
      const current = stack.pop() as string
      if (current === taskId) return true
      if (visited.has(current)) continue
      visited.add(current)
      const deps = this.loadDependenciesForTask(current)
      for (const depId of deps) stack.push(depId)
    }
    return false
  }

  private nextPosition(workspaceId: string, column: TaskColumn): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next_position FROM tasks WHERE workspace_id = ? AND column_name = ?')
      .get(workspaceId, column) as { next_position: number }
    return row.next_position
  }

  private findRunningPane(workspaceId: string): PaneRow | null {
    const rows = this.db
      .prepare('SELECT id, status, agent_profile_id FROM panes WHERE workspace_id = ? ORDER BY row_index ASC, column_index ASC')
      .all(workspaceId) as PaneRow[]
    const pane = rows.find((row) => this.isTerminalRunning(row.id) || row.status === 'running')
    return pane ?? null
  }

  private getRunningPane(workspaceId: string, paneId: string): PaneRow | null {
    const pane = this.db
      .prepare('SELECT id, status, agent_profile_id FROM panes WHERE workspace_id = ? AND id = ?')
      .get(workspaceId, paneId) as PaneRow | undefined
    if (!pane) throw new Error('Terminal does not belong to this workspace')
    return this.isTerminalRunning(pane.id) || pane.status === 'running' ? pane : null
  }

  private getAgentProfile(id?: string): AgentProfileRow | null {
    if (id) {
      const row = this.db
        .prepare('SELECT agent_profile_id, command_template FROM agent_profiles WHERE agent_profile_id = ?')
        .get(id) as AgentProfileRow | undefined
      return row ?? null
    }
    const row = this.db
      .prepare('SELECT agent_profile_id, command_template FROM agent_profiles ORDER BY is_builtin DESC, name ASC LIMIT 1')
      .get() as AgentProfileRow | undefined
    return row ?? null
  }

  private getWorkspace(workspaceId: string): WorkspaceRow {
    const row = this.db
      .prepare('SELECT id, root_path FROM workspaces WHERE id = ?')
      .get(workspaceId) as WorkspaceRow | undefined
    if (!row) throw new Error(`Workspace not found: ${workspaceId}`)
    return row
  }
}

export function parseVerifyCommand(command: string): { file: string; args: string[] } {
  const parts = command.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) throw new Error('Verify command is empty')
  const [file, ...args] = parts
  return { file, args }
}

export function buildPromptPayload(task: Task): string {
  return [
    `# Task: ${task.title}`,
    '',
    '## Description',
    task.description,
    '',
    '## Context',
    task.context,
    '',
    '## Acceptance Criteria',
    task.acceptanceCriteria || 'No explicit acceptance criteria were supplied.',
    '',
    '## Allowed Files',
    task.allowedFiles.length > 0 ? task.allowedFiles.join('\n') : 'No path limit was supplied.',
    '',
    '## Execution Guardrails',
    task.allowedFiles.length > 0
      ? 'Change only the allowed files. If the task requires another file, stop and report the needed scope expansion before changing it.'
      : 'Keep the change set minimal and report every changed file before finishing.',
    'After editing, call oxespace_quality_check with the acceptance criteria when that tool is available. Review every unchanged consumer and address HIGH findings before claiming completion.',
    'Run the verification command when available, link its output and changed tests to the acceptance criteria, then summarize any remaining risk.'
  ].join('\n')
}

function mapTask(row: TaskRow, dependsOn: string[] = []): Task {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    description: row.description,
    context: row.context,
    acceptanceCriteria: row.acceptance_criteria,
    verifyCommand: row.verify_command,
    allowedFiles: parseAllowedFiles(row.allowed_files_json),
    column: row.column_name as TaskColumn,
    runStatus: row.run_status as TaskRunStatus,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dependsOn
  }
}

function mapExecution(row: TaskExecutionRow): TaskExecution {
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.type as TaskExecution['type'],
    agentProfileId: row.agent_profile_id,
    prompt: row.prompt,
    output: row.output,
    exitCode: row.exit_code,
    startedAt: row.started_at,
    completedAt: row.completed_at
  }
}

function parseAllowedFiles(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Verify process failed'
}
