import type { ToolContext, ToolEntry } from './tool-registry'
import { codeWorkspace, domainTool, parsed, service, str, type Args } from './domain-tool'
import { ActionRefused } from '../services/agent-actions/agent-actions'
import { NotifyGate } from '../services/approvals/notify-gate'
import { requesterFor } from '../services/approvals/requester'
import { englishText } from '../agent-text'
import { mainMessage } from '../../../shared/messages'
import { parseAutomationInput } from '../ipc/automations.ipc'
import { parseLinearWorktreeFromIssueInput } from '../ipc/validation'
import type { AutomationSchedule } from '../../../shared/types/automation'

/**
 * Phase 4: things that persist or run on their own (skills, automations) are
 * approved by a person with the full text; small conveniences (a notification,
 * a reindex, a worktree for an issue) run as `write`.
 */

function automations(ctx: ToolContext) {
  const value = service(ctx, 'automations')()
  if (!value) throw new ActionRefused('Automations are unavailable.', 'unavailable')
  return value
}

function ownAutomation(args: Args, rootPath: string, ctx: ToolContext) {
  const id = str(args, 'automationId', 200)
  const automation = automations(ctx).list().find(item => item.id === id && item.rootPath.replace(/[\\/]+$/, '').toLowerCase() === rootPath.replace(/[\\/]+$/, '').toLowerCase())
  if (!automation) throw new ActionRefused('No automation with that id for this project. Use oxespace_automations list.', 'not-found')
  return automation
}

function describeSchedule(schedule: AutomationSchedule): string {
  const at = (hour: number, minute: number) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  switch (schedule.kind) {
    case 'interval': return `every ${schedule.everyMinutes} minutes`
    case 'daily': return `every day at ${at(schedule.hour, schedule.minute)}`
    case 'weekly': return `on days ${schedule.days.join(', ')} (0 = Sunday) at ${at(schedule.hour, schedule.minute)}`
    case 'cron': return `cron "${schedule.expression}"`
  }
}

/** The automation the agent asked for, in this project, without extra CLI arguments (those stay with the person). */
function automationInput(args: Args, rootPath: string) {
  return parsed(() => parseAutomationInput({
    name: args.name, prompt: args.prompt, rootPath, agent: args.agent, baseBranch: args.baseBranch, schedule: args.schedule,
    precheck: args.precheck, timeoutMinutes: args.timeoutMinutes, enabled: args.enabled
  }))
}

const SKILLS_CHANGE = domainTool('oxespace_skills_change', 'Add a skill (a reusable prompt every agent here can call). Skills are standing instructions, so a person approves the whole text.', {
  create: {
    level: 'confirm', description: 'Create a skill for this project (or for the person, scope user).',
    properties: {
      name: { type: 'string', maxLength: 64, description: 'kebab-case, e.g. review-sql.' }, description: { type: 'string', maxLength: 300 },
      body: { type: 'string', maxLength: 5000, description: 'The instructions, in Markdown.' }, scope: { type: 'string', enum: ['workspace', 'user'], description: 'Default workspace.' },
      agents: { type: 'array', items: { type: 'string', enum: ['claude', 'codex'] }, maxItems: 2, description: 'Empty for every agent.' }
    },
    required: ['name', 'description', 'body'],
    confirm: (args, scope) => ({
      summary: `add the skill /${str(args, 'name', 64)} ${str(args, 'scope', 10) === 'user' ? 'for every project' : `to ${scope.name}`}`,
      text: `/${str(args, 'name', 64)} — ${str(args, 'description', 300)}\n\n${str(args, 'body', 5000)}`,
      notes: [mainMessage('approvals.note.skill.followed', {})]
    }),
    run: async (args, scope, ctx) => {
      const agents = Array.isArray(args.agents) ? args.agents.filter((agent): agent is 'claude' | 'codex' => agent === 'claude' || agent === 'codex') : []
      const user = str(args, 'scope', 10) === 'user'
      const skill = service(ctx, 'skills').createSkill({ name: str(args, 'name', 64)!, description: str(args, 'description', 300)!, body: str(args, 'body', 5000)!, agents, scope: user ? 'user' : 'workspace', workspaceRootPath: user ? undefined : scope.rootPath })
      return { name: skill.name, filePath: skill.filePath, source: skill.source }
    }
  }
})

const schedule = {
  type: 'object', description: '{kind:"interval", everyMinutes} | {kind:"daily", hour, minute} | {kind:"weekly", days:[0-6], hour, minute} | {kind:"cron", expression}',
  properties: { kind: { type: 'string', enum: ['interval', 'daily', 'weekly', 'cron'] }, everyMinutes: { type: 'integer' }, hour: { type: 'integer' }, minute: { type: 'integer' }, days: { type: 'array', items: { type: 'integer' } }, expression: { type: 'string', maxLength: 100 } },
  required: ['kind']
}

const AUTOMATIONS_CHANGE = domainTool('oxespace_automations_change', 'Schedule agent runs for this project. Each run works in its own worktree. Creating, enabling and starting them is approved by a person, who sees the prompt, schedule and any precheck command.', {
  create: {
    level: 'confirm', description: 'Create an automation.',
    properties: {
      name: { type: 'string', maxLength: 200 }, prompt: { type: 'string', maxLength: 4000 }, agent: { type: 'string', enum: ['claude', 'codex'] }, schedule,
      baseBranch: { type: 'string', maxLength: 200 }, precheck: { type: 'string', maxLength: 500, description: 'Shell command run first; the run is skipped unless it exits 0.' },
      timeoutMinutes: { type: 'integer', minimum: 1, maximum: 720 }, enabled: { type: 'boolean', description: 'Default true.' }
    },
    required: ['name', 'prompt', 'agent', 'schedule'],
    confirm: (args, scope) => {
      const input = automationInput(args, scope.rootPath)
      return {
        summary: `schedule "${input.name}" (${input.agent}) ${describeSchedule(input.schedule)}`,
        text: `${input.agent} in ${scope.rootPath}, ${describeSchedule(input.schedule)}${input.enabled === false ? ' (created disabled)' : ''}${input.baseBranch ? `\nfrom ${input.baseBranch}` : ''}${input.precheck ? `\nprecheck: ${input.precheck}` : ''}\n\n${input.prompt}`,
        notes: [mainMessage('approvals.note.automation.runsAlone', {})]
      }
    },
    run: async (args, scope, ctx) => automations(ctx).create(automationInput(args, scope.rootPath))
  },
  disable: {
    level: 'write', description: 'Turn an automation off.', properties: { automationId: { type: 'string', maxLength: 200 } }, required: ['automationId'],
    run: async (args, scope, ctx) => automations(ctx).setEnabled(ownAutomation(args, scope.rootPath, ctx).id, false)
  },
  enable: {
    level: 'confirm', description: 'Turn an automation on.', required: ['automationId'],
    confirm: (args, scope, ctx) => { const automation = ownAutomation(args, scope.rootPath, ctx); return { summary: `turn on "${automation.name}"`, text: `${automation.agent}, ${describeSchedule(automation.schedule)}\n\n${automation.prompt}` } },
    run: async (args, scope, ctx) => automations(ctx).setEnabled(ownAutomation(args, scope.rootPath, ctx).id, true)
  },
  run_now: {
    level: 'confirm', description: 'Start one run now.', required: ['automationId'],
    confirm: (args, scope, ctx) => { const automation = ownAutomation(args, scope.rootPath, ctx); return { summary: `run "${automation.name}" now`, text: `${automation.agent} in a new worktree of ${automation.rootPath}\n\n${automation.prompt}` } },
    run: async (args, scope, ctx) => automations(ctx).runNow(ownAutomation(args, scope.rootPath, ctx).id)
  },
  remove: {
    level: 'confirm', description: 'Delete an automation and its schedule.', required: ['automationId'],
    confirm: (args, scope, ctx) => { const automation = ownAutomation(args, scope.rootPath, ctx); return { summary: `delete the automation "${automation.name}"`, text: `Delete "${automation.name}" (${describeSchedule(automation.schedule)})` } },
    run: async (args, scope, ctx) => { automations(ctx).remove(ownAutomation(args, scope.rootPath, ctx).id); return { removed: true } }
  }
})

/** One per process: the limit is per execution, across every call of the tool. */
export const notifyGate = new NotifyGate()

const WORKSPACE_CHANGE = domainTool('oxespace_workspace_change', 'Small workspace actions: tell the person something with a desktop notification, rebuild the semantic index, start a worktree for a Linear issue.', {
  notify: {
    level: 'write', description: 'Show a desktop notification (for example when a long job ends).',
    properties: { title: { type: 'string', minLength: 1, maxLength: 100 }, body: { type: 'string', maxLength: 500 } }, required: ['title'],
    run: async (args, scope, ctx) => {
      const title = str(args, 'title', 100)!.replace(/\s+/g, ' ')
      const body = (str(args, 'body', 500) ?? '').slice(0, 500)
      // B10: no app names, a per-minute limit, and the title prefixed by the app with who sent it.
      const refused = notifyGate.check(scope.actor.key, title, body)
      if (refused) throw new ActionRefused(englishText(refused), refused.code === 'notify.refused.rateLimit' ? 'rate-limited' : 'reserved-name')
      const requester = scope.actor.requester ?? (scope.owner ? requesterFor(scope.owner) : undefined)
      if (!requester) throw new ActionRefused('A notification must come from an agent running inside OXESpace.', 'no-execution')
      return { shown: service(ctx, 'notify')(requester, title, body) }
    }
  },
  reindex: {
    level: 'write', description: 'Rebuild the semantic index of this Code workspace (after large changes).',
    run: async (_args, scope, ctx) => {
      const workspaceId = codeWorkspace(scope)
      const status = ctx.semantic.reindex(workspaceId)
      return { indexing: status.indexing, enabled: status.enabled }
    }
  },
  worktree_for_linear_issue: {
    level: 'write', description: 'Create a branch and worktree named after a Linear issue.',
    properties: { issueId: { type: 'string', maxLength: 200 }, baseRef: { type: 'string', maxLength: 200 } }, required: ['issueId'],
    run: async (args, scope, ctx) => service(ctx, 'linear').createWorktreeFromIssue(parsed(() => parseLinearWorktreeFromIssueInput({ workspaceId: codeWorkspace(scope), rootPath: scope.rootPath, issueId: args.issueId, baseRef: args.baseRef })))
  }
})

/** A server this workspace can see, never OXESpace's own bridge. Adding, editing and trusting servers stay with the person. */
function visibleServer(args: Args, workspaceId: string | null, ctx: ToolContext) {
  const id = str(args, 'serverId', 200)
  const server = service(ctx, 'mcpServers').list(workspaceId?.startsWith('thread:') ? null : workspaceId).find(item => item.id === id && item.name !== 'oxespace')
  if (!server) throw new ActionRefused('No MCP server with that id here. Use oxespace_mcp_servers list.', 'not-found')
  return server
}

const MCP_SERVERS_CHANGE = domainTool('oxespace_mcp_servers_change', 'Start or stop MCP servers the person configured and trusted. Adding, editing and trusting servers stay with the person.', {
  start: {
    level: 'confirm', description: 'Start a trusted server (it runs its command on this machine).', properties: { serverId: { type: 'string', maxLength: 200 } }, required: ['serverId'],
    confirm: (args, scope, ctx) => {
      const server = visibleServer(args, scope.workspaceId, ctx)
      if (server.guard?.quarantine) throw new ActionRefused('This server is quarantined: its tools changed after the person trusted it. Only the person can trust it again, in Connections.', 'untrusted')
      if (!server.trusted) throw new ActionRefused('This server is not trusted. Only the person can trust it, in Connections.', 'untrusted')
      return { summary: `start the MCP server "${server.name}"`, text: `Start "${server.name}" (${server.transport})` }
    },
    run: async (args, scope, ctx) => ({ tools: (await service(ctx, 'mcpServers').start(visibleServer(args, scope.workspaceId, ctx).id)).map(tool => tool.name) })
  },
  stop: {
    level: 'write', description: 'Stop a running server.', required: ['serverId'],
    run: async (args, scope, ctx) => { service(ctx, 'mcpServers').stopRuntime(visibleServer(args, scope.workspaceId, ctx).id); return { stopped: true } }
  }
})

export const APP_MANAGE_TOOLS: ToolEntry[] = [SKILLS_CHANGE, AUTOMATIONS_CHANGE, WORKSPACE_CHANGE, MCP_SERVERS_CHANGE]
export const APP_MANAGE_TOOL_NAMES = APP_MANAGE_TOOLS.map(tool => tool.descriptor.name)
export { describeSchedule }
