import type { ToolContext, ToolEntry } from './tool-registry'
import { bool, codeWorkspace, domainTool, int, parsed, service, str, type ActionScope, type Args } from './domain-tool'
import { ActionRefused } from '../services/agent-actions/agent-actions'
import {
  parseGitHubCreateCheckpointInput, parseGitHubCreatePullRequestInput, parseGitHubCreateReleaseInput, parseGitHubFileInput,
  parseGitHubRestoreCheckpointInput, parseGitHubWorkflowRunInput, parseTaskCreateInput, parseTaskReorderInput, parseTaskUpdateInput
} from '../ipc/validation'
import type { ConversationThread } from '../../../shared/types/thread'
import type { Task } from '../../../shared/types/task'
import { lazy } from './app-settings-tools'

/**
 * Tools that change the app. They are separate from the read tools so a
 * read-only Thread keeps every read and gets none of these, and so the bridge
 * never retries them on its own. Things a person must keep (approvals, access,
 * credentials, trust, typing into an agent's terminal) have no action here.
 */

const workspaceInput = (scope: ActionScope) => ({ workspaceId: scope.workspaceId ?? 'mcp', rootPath: scope.rootPath })

/** A branch, tag or ref the person can read, that git cannot mistake for an option. */
function refName(args: Args, field: string, required = true): string | undefined {
  const value = str(args, field, 200)
  if (value === undefined) { if (required) throw new ActionRefused(`${field} is required.`, 'invalid'); return undefined }
  if (!/^(?!-)[A-Za-z0-9._/@{}^~-]+$/.test(value) || value.includes('..') || value.endsWith('.lock')) throw new ActionRefused(`${field} must be a branch, tag or commit name.`, 'invalid')
  return value
}

function text(args: Args, field: string, max: number): string {
  const value = str(args, field, max)
  if (!value?.trim()) throw new ActionRefused(`${field} is required.`, 'invalid')
  return value
}

function id(args: Args, field: string): string {
  const value = str(args, field, 200)
  if (!value) throw new ActionRefused(`${field} is required.`, 'invalid')
  return value
}

function github(ctx: ToolContext) { return service(ctx, 'github') }

// ---- git ------------------------------------------------------------------

const GIT_CHANGE = domainTool('oxespace_git_change', 'Change the Git state of your project (the directory you run in). Local changes run directly; anything that leaves this machine or moves other terminals to another branch is approved by a person.', {
  stage: { level: 'write', description: 'Stage one file.', properties: { path: { type: 'string', maxLength: 1024, description: 'Path relative to the repository root.' } }, required: ['path'],
    run: (args, scope, ctx) => github(ctx).stageFile(parsed(() => parseGitHubFileInput({ ...workspaceInput(scope), path: args.path }))) },
  stage_all: { level: 'write', description: 'Stage every change.', run: (_a, scope, ctx) => github(ctx).stageAll(workspaceInput(scope)) },
  unstage: { level: 'write', description: 'Unstage one file (its changes stay in the work tree).', required: ['path'],
    run: (args, scope, ctx) => github(ctx).unstageFile(parsed(() => parseGitHubFileInput({ ...workspaceInput(scope), path: args.path }))) },
  commit: { level: 'write', description: 'Commit what is staged, locally.', properties: { message: { type: 'string', minLength: 1, maxLength: 5000 } }, required: ['message'],
    run: (args, scope, ctx) => github(ctx).commit({ ...workspaceInput(scope), message: text(args, 'message', 5000) }) },
  create_branch: { level: 'write', description: 'Create a branch at HEAD without switching to it.', properties: { name: { type: 'string', maxLength: 200 } }, required: ['name'],
    run: (args, scope, ctx) => github(ctx).createBranch({ ...workspaceInput(scope), name: refName(args, 'name')!, checkout: false }) },
  fetch: { level: 'write', description: 'Fetch from the remotes.', run: (_a, scope, ctx) => github(ctx).fetch(workspaceInput(scope)) },
  pull: { level: 'write', description: 'Pull, fast-forward only.', run: (_a, scope, ctx) => github(ctx).pullFfOnly(workspaceInput(scope)) },
  create_checkpoint: { level: 'write', description: 'Save a named checkpoint of the work tree.', properties: { description: { type: 'string', maxLength: 2000 } }, required: ['name'],
    run: (args, scope, ctx) => github(ctx).createCheckpoint(parsed(() => parseGitHubCreateCheckpointInput({ ...workspaceInput(scope), name: text(args, 'name', 200), description: args.description }))) },
  checkout: {
    level: 'confirm', description: 'Switch the work tree to another branch. Every terminal and Thread in this folder sees the switch.', required: ['name'],
    confirm: (args, scope) => ({ summary: `switch ${scope.name} to branch ${refName(args, 'name')}`, text: `git checkout ${refName(args, 'name')}\nin ${scope.rootPath}`, reasons: ['Other terminals and Threads working in this folder will see the other branch.'] }),
    run: (args, scope, ctx) => github(ctx).checkoutBranch({ rootPath: scope.rootPath, name: refName(args, 'name')! })
  },
  push: {
    level: 'confirm', description: 'Push the current branch to its upstream.',
    confirm: async (_a, scope, ctx) => {
      const status = await ctx.git?.getStatus(scope.rootPath)
      const what = status ? `${status.branch ?? 'HEAD'} → ${status.upstream ?? 'its upstream'} (${status.ahead} commit${status.ahead === 1 ? '' : 's'} ahead)` : 'the current branch'
      return { summary: `push ${status?.branch ?? 'the current branch'}`, text: `git push\n${what}\nin ${scope.rootPath}` }
    },
    run: (_a, scope, ctx) => github(ctx).push(workspaceInput(scope))
  },
  restore_checkpoint: {
    level: 'confirm', description: 'Restore the work tree to a checkpoint; current changes are replaced.', properties: { checkpointId: { type: 'string', maxLength: 200 } }, required: ['checkpointId'],
    confirm: (args, scope, ctx) => {
      const checkpoint = github(ctx).listCheckpoints(workspaceInput(scope)).find(item => item.id === id(args, 'checkpointId'))
      if (!checkpoint) throw new ActionRefused('No checkpoint with that id here.', 'not-found')
      return { summary: `restore checkpoint "${checkpoint.name}"`, text: `Restore checkpoint "${checkpoint.name}"\nin ${scope.rootPath}`, reasons: ['Uncommitted changes in the work tree are replaced.'] }
    },
    run: (args, scope, ctx) => github(ctx).restoreCheckpoint(parsed(() => parseGitHubRestoreCheckpointInput({ ...workspaceInput(scope), checkpointId: args.checkpointId })))
  },
  delete_checkpoint: {
    level: 'confirm', description: 'Delete a checkpoint; it cannot be restored afterwards.', required: ['checkpointId'],
    confirm: async (args, scope, ctx) => (await import('./app-settings-actions')).deleteCheckpointApproval(args, scope, ctx), run: lazy('delete_checkpoint')
  }
})

// ---- GitHub ---------------------------------------------------------------

const GITHUB_CHANGE = domainTool('oxespace_github_change', 'Act on GitHub for your project through the GitHub CLI (gh). A person approves every call, seeing exactly what will be sent.', {
  create_pull_request: {
    level: 'confirm', description: 'Open a pull request.',
    properties: { title: { type: 'string', maxLength: 300 }, body: { type: 'string', maxLength: 5000 }, base: { type: 'string', maxLength: 200 }, head: { type: 'string', maxLength: 200 }, draft: { type: 'boolean' } },
    required: ['title'],
    confirm: (args) => ({ summary: `open a pull request "${text(args, 'title', 300)}"`, text: `${bool(args, 'draft', false) ? 'Draft pull request' : 'Pull request'} into ${refName(args, 'base', false) ?? 'the default branch'} from ${refName(args, 'head', false) ?? 'the current branch'}\nTitle: ${args.title}\n\n${str(args, 'body', 5000) ?? ''}` }),
    run: (args, scope, ctx) => github(ctx).createPullRequest(parsed(() => parseGitHubCreatePullRequestInput({ ...workspaceInput(scope), title: args.title, body: args.body, base: refName(args, 'base', false), head: refName(args, 'head', false), draft: args.draft })))
  },
  set_auto_merge: {
    level: 'confirm', description: 'Turn auto-merge on or off for a pull request.', properties: { number: { type: 'integer', minimum: 1 }, enable: { type: 'boolean' } }, required: ['number', 'enable'],
    confirm: (args) => ({ summary: `${bool(args, 'enable', true) ? 'turn on' : 'turn off'} auto-merge for #${int(args, 'number', 0, 1, Number.MAX_SAFE_INTEGER)}`, text: `Auto-merge ${bool(args, 'enable', true) ? 'ON' : 'OFF'} for pull request #${int(args, 'number', 0, 1, Number.MAX_SAFE_INTEGER)}`, reasons: bool(args, 'enable', true) ? ['The pull request merges by itself once its checks and reviews pass.'] : [] }),
    run: (args, scope, ctx) => github(ctx).setPullRequestAutoMerge({ ...workspaceInput(scope), number: int(args, 'number', 0, 1, Number.MAX_SAFE_INTEGER), enable: bool(args, 'enable', true) })
  },
  create_release: {
    level: 'confirm', description: 'Create a release and its tag.',
    properties: { tagName: { type: 'string', maxLength: 200 }, title: { type: 'string', maxLength: 300 }, draft: { type: 'boolean' }, notes: { type: 'string', maxLength: 5000 }, generateNotes: { type: 'boolean' }, prerelease: { type: 'boolean' } },
    required: ['tagName'],
    confirm: (args) => ({ summary: `publish release ${refName(args, 'tagName')}`, text: `${bool(args, 'draft', false) ? 'Draft release' : bool(args, 'prerelease', false) ? 'Pre-release' : 'Release'} ${args.tagName}${args.title ? ` "${args.title}"` : ''}${bool(args, 'generateNotes', false) ? '\nNotes generated by GitHub' : ''}\n\n${str(args, 'notes', 5000) ?? ''}`, reasons: bool(args, 'draft', false) ? [] : ['A published release is visible to everyone with access to the repository and may notify watchers.'] }),
    run: (args, scope, ctx) => github(ctx).createRelease(parsed(() => parseGitHubCreateReleaseInput({ ...workspaceInput(scope), tagName: refName(args, 'tagName'), title: args.title, notes: args.notes, generateNotes: args.generateNotes, prerelease: args.prerelease, draft: args.draft })))
  },
  run_workflow: {
    level: 'confirm', description: 'Start a workflow (workflow_dispatch).',
    properties: { workflowId: { type: 'string', maxLength: 200, description: 'File name or id from oxespace_github workflows.' }, ref: { type: 'string', maxLength: 200 }, fields: { type: 'object', additionalProperties: { type: 'string', maxLength: 1000 }, description: 'Workflow inputs.' } },
    required: ['workflowId'],
    confirm: (args) => ({ summary: `run workflow ${refName(args, 'workflowId')}`, text: `Run workflow ${args.workflowId} on ${refName(args, 'ref', false) ?? 'the default branch'}${args.fields ? `\nInputs: ${JSON.stringify(args.fields)}` : ''}` }),
    run: (args, scope, ctx) => github(ctx).runWorkflow(parsed(() => parseGitHubWorkflowRunInput({ ...workspaceInput(scope), workflowId: refName(args, 'workflowId'), ref: refName(args, 'ref', false), fields: args.fields })))
  },
  rerun: {
    level: 'confirm', description: 'Run a workflow run again (failed jobs only by default).', properties: { runId: { type: 'integer', minimum: 1 }, failedOnly: { type: 'boolean' } }, required: ['runId'],
    confirm: (args) => ({ summary: `re-run workflow run ${int(args, 'runId', 0, 1, Number.MAX_SAFE_INTEGER)}`, text: `Re-run ${bool(args, 'failedOnly', true) ? 'the failed jobs of' : 'all jobs of'} workflow run ${int(args, 'runId', 0, 1, Number.MAX_SAFE_INTEGER)}` }),
    run: (args, scope, ctx) => github(ctx).rerunRun({ rootPath: scope.rootPath, runId: int(args, 'runId', 0, 1, Number.MAX_SAFE_INTEGER), failedOnly: bool(args, 'failedOnly', true) })
  }
})

// ---- Threads --------------------------------------------------------------

async function targetThread(args: Args, scope: ActionScope, ctx: ToolContext): Promise<{ thread: ConversationThread; owned: boolean }> {
  if (!ctx.threads) throw new ActionRefused('Threads are unavailable right now.', 'unavailable')
  const manager = await ctx.threads
  const threadId = id(args, 'threadId')
  if (scope.owner?.kind === 'thread' && scope.owner.id === threadId) throw new ActionRefused('A Thread cannot act on itself through this tool.', 'invalid')
  const all = manager.list()
  const self = scope.owner?.kind === 'thread' ? all.find(thread => thread.id === scope.owner!.id) : undefined
  const root = scope.rootPath.replace(/[\\/]+$/, '').toLowerCase()
  const thread = all.find(item => item.id === threadId && (self ? item.projectId === self.projectId : item.rootPath.replace(/[\\/]+$/, '').toLowerCase() === root))
  if (!thread) throw new ActionRefused('No Thread with that id in this project. Use oxespace_threads list.', 'not-found')
  // A Thread this caller created (handoff) or one of its Agent Work workers is the caller's own to drive.
  const owned = Boolean(self && ctx.db && (ctx.db.prepare('SELECT 1 FROM mcp_thread_handoffs WHERE origin_thread_id = ? AND destination_thread_id = ?').get(self.id, thread.id)
    ?? manager.work?.isWorkerOf(self.id, thread.id)))
  return { thread, owned }
}

const ownedNote = 'A person approves unless the Thread was created by the caller (oxespace_thread_create or Agent Work).'

function ownedOrAsk(verb: (thread: ConversationThread, args: Args) => { summary: string; text: string; reasons?: string[] }) {
  return async (args: Args, scope: ActionScope, ctx: ToolContext) => {
    const { thread, owned } = await targetThread(args, scope, ctx)
    return owned ? null : verb(thread, args)
  }
}

const THREADS_CHANGE = domainTool('oxespace_threads_change', 'Drive other Threads of your project: send, steer, stop, set the model, rename, archive. Never their access level, approvals or permission rules: those stay with the person.', {
  send: {
    level: 'confirm', description: 'Send a message (queued if the Thread is working).', approvalNote: ownedNote,
    properties: { threadId: { type: 'string', maxLength: 200 }, text: { type: 'string', minLength: 1, maxLength: 20_000 } }, required: ['threadId', 'text'],
    confirm: ownedOrAsk((thread, args) => ({ summary: `send a message to "${thread.title}"`, text: text(args, 'text', 20_000), reasons: ['The other conversation will act on this message with its own access.'] })),
    run: async (args, scope, ctx) => { const { thread } = await targetThread(args, scope, ctx); await (await ctx.threads!).send(thread.id, text(args, 'text', 20_000)); return { sent: true } }
  },
  steer: {
    level: 'confirm', description: 'Add guidance to the running turn.', approvalNote: ownedNote, required: ['threadId', 'text'],
    confirm: ownedOrAsk((thread, args) => ({ summary: `steer "${thread.title}"`, text: text(args, 'text', 20_000) })),
    run: async (args, scope, ctx) => { const { thread } = await targetThread(args, scope, ctx); await (await ctx.threads!).steer(thread.id, text(args, 'text', 20_000)); return { steered: true } }
  },
  interrupt: {
    level: 'confirm', description: 'Stop the running turn.', approvalNote: ownedNote, required: ['threadId'],
    confirm: ownedOrAsk(thread => ({ summary: `stop the running turn of "${thread.title}"`, text: `Stop the turn of "${thread.title}"` })),
    run: async (args, scope, ctx) => { const { thread } = await targetThread(args, scope, ctx); await (await ctx.threads!).interrupt(thread.id); return { interrupted: true } }
  },
  configure: {
    level: 'confirm', description: 'Set the model and/or reasoning effort (never access, approvals or mode).', approvalNote: ownedNote,
    properties: { model: { type: 'string', maxLength: 200 }, reasoningEffort: { type: 'string', maxLength: 30 } }, required: ['threadId'],
    confirm: ownedOrAsk((thread, args) => ({ summary: `change the model of "${thread.title}"`, text: `Model: ${str(args, 'model', 200) ?? thread.model ?? 'unchanged'}\nEffort: ${str(args, 'reasoningEffort', 30) ?? 'unchanged'}` })),
    run: async (args, scope, ctx) => {
      const { thread } = await targetThread(args, scope, ctx)
      const model = str(args, 'model', 200), reasoningEffort = str(args, 'reasoningEffort', 30)
      if (!model && !reasoningEffort) throw new ActionRefused('Give model or reasoningEffort.', 'invalid')
      if (model && !/^[a-z0-9][a-z0-9._:/[\]-]{0,199}$/i.test(model)) throw new ActionRefused('Invalid model.', 'invalid')
      if (reasoningEffort && !/^[a-z0-9_-]{1,30}$/i.test(reasoningEffort)) throw new ActionRefused('Invalid effort.', 'invalid')
      const manager = await ctx.threads!
      const revision = (manager.read(thread.id).thread as { configurationRevision?: number }).configurationRevision ?? 0
      const next = await manager.configure(thread.id, { ...(model ? { model } : {}), ...(reasoningEffort ? { reasoningEffort } : {}) }, revision)
      return { model: next.thread.model ?? null, reasoningEffort: next.thread.reasoningEffort ?? null }
    }
  },
  rename: {
    level: 'confirm', description: 'Rename a Thread.', approvalNote: ownedNote, properties: { title: { type: 'string', maxLength: 120 } }, required: ['threadId', 'title'],
    confirm: ownedOrAsk((thread, args) => ({ summary: `rename "${thread.title}"`, text: `New name: ${text(args, 'title', 120)}` })),
    run: async (args, scope, ctx) => { const { thread } = await targetThread(args, scope, ctx); await (await ctx.threads!).command(thread.id, `/rename ${text(args, 'title', 120).replace(/[\r\n]+/g, ' ')}`); return { renamed: true } }
  },
  archive: {
    level: 'confirm', description: 'Archive a Thread (it can be restored by the person).', required: ['threadId'],
    confirm: async (args, scope, ctx) => { const { thread } = await targetThread(args, scope, ctx); return { summary: `archive "${thread.title}"`, text: `Archive the Thread "${thread.title}"`, reasons: thread.status === 'running' ? ['Its running turn is stopped first.'] : [] } },
    run: async (args, scope, ctx) => {
      const { thread } = await targetThread(args, scope, ctx)
      const manager = await ctx.threads!
      // The command's real outcome: a conversation whose children still work is not archived (B1.3), and
      // archiving them too is the person's decision, never an agent's.
      const result = await manager.command(thread.id, '/archive confirm')
      if (result.kind !== 'navigate' || !manager.readThread(thread.id).archived) {
        throw new ActionRefused(result.refusal === 'hasActiveChildren'
          ? `"${thread.title}" was not archived: ${result.confirm?.childConversations?.active ?? 'some'} conversation(s) it started are still working. The person can archive them together from the app.`
          : `"${thread.title}" was not archived.`, result.refusal ?? 'refused')
      }
      return { archived: true }
    }
  }
})

// ---- Tasks ----------------------------------------------------------------

function ownTask(args: Args, scope: ActionScope, ctx: ToolContext): Task {
  const task = service(ctx, 'tasks').list(codeWorkspace(scope)).find(item => item.id === id(args, 'taskId'))
  if (!task) throw new ActionRefused('No task with that id in this workspace.', 'not-found')
  return task
}

const taskFields = {
  title: { type: 'string', maxLength: 300 }, description: { type: 'string', maxLength: 10_000 }, context: { type: 'string', maxLength: 10_000 },
  acceptanceCriteria: { type: 'string', maxLength: 10_000 }, verifyCommand: { type: 'string', maxLength: 2000, description: 'Command that checks the task; a person approves each run of it.' },
  allowedFiles: { type: 'array', items: { type: 'string', maxLength: 1024 }, maxItems: 200 }, column: { type: 'string', enum: ['backlog', 'ready', 'running', 'review', 'done'] }
}

const TASKS_CHANGE = domainTool('oxespace_tasks_change', 'Change the task board of your Code workspace. Starting a task in an agent\'s terminal stays with the person.', {
  create: { level: 'write', description: 'Create a task.', properties: taskFields, required: ['title'],
    run: async (args, scope, ctx) => service(ctx, 'tasks').create(parsed(() => parseTaskCreateInput({ workspaceId: codeWorkspace(scope), title: args.title, description: args.description, context: args.context, acceptanceCriteria: args.acceptanceCriteria, verifyCommand: args.verifyCommand, allowedFiles: args.allowedFiles, column: args.column }))) },
  update: { level: 'write', description: 'Change fields of a task.', properties: { taskId: { type: 'string', maxLength: 200 } }, required: ['taskId'],
    run: async (args, scope, ctx) => {
      const task = ownTask(args, scope, ctx)
      const { action: _action, taskId: _taskId, ...fields } = args
      return service(ctx, 'tasks').update(task.id, parsed(() => parseTaskUpdateInput(fields)))
    } },
  reorder: { level: 'write', description: 'Order the tasks of a column.', properties: { orderedIds: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 500 } }, required: ['column', 'orderedIds'],
    run: async (args, scope, ctx) => service(ctx, 'tasks').reorder(parsed(() => parseTaskReorderInput({ workspaceId: codeWorkspace(scope), column: args.column, orderedIds: args.orderedIds }))) },
  add_dependency: { level: 'write', description: 'Make a task wait for another.', properties: { dependsOnTaskId: { type: 'string', maxLength: 200 } }, required: ['taskId', 'dependsOnTaskId'],
    run: async (args, scope, ctx) => { const task = ownTask(args, scope, ctx); ownTask({ taskId: args.dependsOnTaskId }, scope, ctx); return service(ctx, 'tasks').addDependency(task.id, id(args, 'dependsOnTaskId')) } },
  remove_dependency: { level: 'write', description: 'Remove a dependency.', required: ['taskId', 'dependsOnTaskId'],
    run: async (args, scope, ctx) => service(ctx, 'tasks').removeDependency(ownTask(args, scope, ctx).id, id(args, 'dependsOnTaskId')) },
  verify: { level: 'confirm', description: 'Run the task\'s verify command in the workspace.', required: ['taskId'],
    confirm: (args, scope, ctx) => { const task = ownTask(args, scope, ctx); if (!task.verifyCommand.trim()) throw new ActionRefused('This task has no verify command.', 'invalid'); return { summary: `verify task "${task.title}"`, text: `${task.verifyCommand}\nin ${scope.rootPath}` } },
    run: async (args, scope, ctx) => service(ctx, 'tasks').verify({ taskId: ownTask(args, scope, ctx).id }) },
  delete: { level: 'confirm', description: 'Delete a task.', required: ['taskId'],
    confirm: (args, scope, ctx) => { const task = ownTask(args, scope, ctx); return { summary: `delete task "${task.title}"`, text: `Delete the task "${task.title}" and its history` } },
    run: async (args, scope, ctx) => { service(ctx, 'tasks').delete(ownTask(args, scope, ctx).id); return { deleted: true } } }
})

export const APP_WRITE_TOOLS: ToolEntry[] = [GIT_CHANGE, GITHUB_CHANGE, THREADS_CHANGE, TASKS_CHANGE]
export const APP_WRITE_TOOL_NAMES = APP_WRITE_TOOLS.map(tool => tool.descriptor.name)
