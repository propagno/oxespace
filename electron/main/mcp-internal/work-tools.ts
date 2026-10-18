import type { ToolContext, ToolEntry } from './tool-registry'
import type { WorkPlanInput, WorkRun } from '../../../shared/types/work'

function input(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be an object')
  return args as Record<string, unknown>
}

/** The live Thread calling the tool; Agent Work is only reachable from a Thread execution. */
function origin(ctx: ToolContext): string {
  const execution = ctx.executions?.authenticate(ctx.executionId, ctx.executionToken, ctx.workspaceId)
  if (!execution || execution.owner.kind !== 'thread') throw new Error('Open this tool from a live OXESpace Thread execution')
  return execution.owner.id
}

async function work(ctx: ToolContext) {
  if (!ctx.threads) throw new Error('Thread service is unavailable')
  return (await ctx.threads).work
}

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

function string(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${name} is required`)
  return value
}

/** What a supervisor needs to decide its next step, without full prompts or results. */
function overview(run: WorkRun) {
  return {
    runId: run.id, title: run.title, status: run.status,
    budget: run.budget, spent: { usd: Number(run.spent.usd.toFixed(4)), turns: run.spent.turns },
    tasks: run.tasks.map(task => ({ key: task.key, title: task.title, status: task.status, access: task.access, provider: task.provider,
      ...(task.dependsOn.length ? { dependsOn: task.dependsOn } : {}), ...(task.threadId ? { threadId: task.threadId } : {}),
      ...(task.reason ? { reason: task.reason } : {}), ...(task.result ? { verdict: task.result.verdict, filesChanged: task.result.filesChanged.length } : {}) }))
  }
}

export const WORK_TOOLS: ToolEntry[] = [
  {
    descriptor: { name: 'oxespace_work_plan', description: 'Split work into tasks that run in parallel worker Threads in this project. A task starts when every task in its dependsOn succeeded; tasks that edit files (access workspace-write) run one at a time. You get a message in this conversation when a task fails or waits for input, and when the run ends. Retrying with the same key returns the same run.', inputSchema: {
      type: 'object', properties: {
        key: { type: 'string', minLength: 8, maxLength: 100, description: 'Stable idempotency key for this plan.' },
        title: { type: 'string', minLength: 1, maxLength: 200 },
        tasks: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', properties: {
          key: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$' },
          title: { type: 'string', minLength: 1, maxLength: 200 },
          prompt: { type: 'string', minLength: 1, maxLength: 32768, description: 'Complete instructions; the worker does not see this conversation.' },
          dependsOn: { type: 'array', items: { type: 'string' }, description: 'Keys of tasks whose results this task needs.' },
          access: { type: 'string', enum: ['read-only', 'workspace-write'], description: 'Default read-only. Never more than this conversation has.' },
          provider: { type: 'string', enum: ['claude', 'codex'], description: 'Default: the same provider as this conversation.' }
        }, required: ['key', 'title', 'prompt'], additionalProperties: false } },
        budget: { type: 'object', properties: { usd: { type: 'number', exclusiveMinimum: 0, maximum: 1000 }, turns: { type: 'integer', minimum: 1, maximum: 500 } }, additionalProperties: false, description: 'Stops the run when the workers reach it.' },
        autoWake: { type: 'boolean', description: 'Default true: failures, blocks and the end of the run arrive as messages here.' }
      }, required: ['key', 'title', 'tasks'], additionalProperties: false
    } },
    requiresWorkspace: true,
    handler: async (args, ctx) => {
      const supervisor = origin(ctx)
      const run = (await work(ctx)).plan(supervisor, input(args) as unknown as WorkPlanInput)
      return result({ ...overview(run), next: 'Wait for the messages this run sends here, or check oxespace_work_status. Do not poll in a loop.' })
    }
  },
  {
    descriptor: { name: 'oxespace_work_status', description: 'Status of the Agent Work runs this conversation supervises: every task, its worker Thread, and spending against the budget. Pass runId for one run.', inputSchema: {
      type: 'object', properties: { runId: { type: 'string' } }, additionalProperties: false
    } },
    requiresWorkspace: true,
    handler: async (args, ctx) => {
      const supervisor = origin(ctx), values = input(args), service = await work(ctx)
      if (values.runId !== undefined) {
        const run = service.supervised(supervisor, string(values.runId, 'runId'))
        return result({ ...overview(run), events: service.events(run.id, 20).map(event => ({ at: new Date(event.at).toISOString(), kind: event.kind, detail: event.detail })) })
      }
      return result({ runs: service.runsFor(supervisor).filter(run => run.supervisorThreadId === supervisor).map(overview) })
    }
  },
  {
    descriptor: { name: 'oxespace_work_result', description: "A finished task's result: the worker's closing summary, files changed and tool outcomes. For the full conversation use oxespace_thread_read with the task's threadId.", inputSchema: {
      type: 'object', properties: { runId: { type: 'string' }, taskKey: { type: 'string' } }, required: ['runId', 'taskKey'], additionalProperties: false
    } },
    requiresWorkspace: true,
    handler: async (args, ctx) => {
      const supervisor = origin(ctx), values = input(args)
      const run = (await work(ctx)).supervised(supervisor, string(values.runId, 'runId'))
      const task = run.tasks.find(value => value.key === values.taskKey)
      if (!task) throw new Error(`Task ${String(values.taskKey)} not found in this run`)
      return result({ key: task.key, title: task.title, status: task.status, ...(task.reason ? { reason: task.reason } : {}), ...(task.threadId ? { threadId: task.threadId } : {}),
        result: task.result ?? null, ...(task.result ? {} : { note: task.status === 'running' || task.status === 'blocked' ? 'The task has not finished.' : 'The task produced no result.' }) })
    }
  },
  {
    descriptor: { name: 'oxespace_work_message', description: "Send a follow-up to a task's worker Thread. A finished task runs again with it and reports a new result.", inputSchema: {
      type: 'object', properties: { runId: { type: 'string' }, taskKey: { type: 'string' }, text: { type: 'string', minLength: 1, maxLength: 65536 } }, required: ['runId', 'taskKey', 'text'], additionalProperties: false
    } },
    requiresWorkspace: true,
    handler: async (args, ctx) => {
      const supervisor = origin(ctx), values = input(args), service = await work(ctx)
      const run = service.supervised(supervisor, string(values.runId, 'runId'))
      const task = await service.message(run.id, string(values.taskKey, 'taskKey'), string(values.text, 'text'))
      return result({ key: task.key, status: task.status, threadId: task.threadId })
    }
  },
  {
    descriptor: { name: 'oxespace_work_cancel', description: 'Cancel a whole run, or one task with taskKey. Running workers are stopped; tasks that depend on a cancelled task are cancelled too.', inputSchema: {
      type: 'object', properties: { runId: { type: 'string' }, taskKey: { type: 'string' } }, required: ['runId'], additionalProperties: false
    } },
    requiresWorkspace: true,
    handler: async (args, ctx) => {
      const supervisor = origin(ctx), values = input(args), service = await work(ctx)
      const run = service.supervised(supervisor, string(values.runId, 'runId'))
      return result(overview(await service.cancel(run.id, 'supervisor', values.taskKey === undefined ? undefined : string(values.taskKey, 'taskKey'))))
    }
  }
]
