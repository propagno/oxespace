import type { ToolContext, ToolEntry } from './tool-registry'
import { domainTool, service, str, type Args } from './domain-tool'
import { ActionRefused } from '../services/agent-actions/agent-actions'
import { NotifyGate } from '../services/approvals/notify-gate'
import { requesterFor } from '../services/approvals/requester'
import { englishText } from '../agent-text'
import { mainMessage } from '../../../shared/messages'

/**
 * Phase 4: things that persist (skills) are approved by a person with the full
 * text; small conveniences (a notification) run as `write`.
 */

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

/** One per process: the limit is per execution, across every call of the tool. */
export const notifyGate = new NotifyGate()

const WORKSPACE_CHANGE = domainTool('oxespace_workspace_change', 'Small workspace actions: tell the person something with a desktop notification.', {
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

export const APP_MANAGE_TOOLS: ToolEntry[] = [SKILLS_CHANGE, WORKSPACE_CHANGE, MCP_SERVERS_CHANGE]
export const APP_MANAGE_TOOL_NAMES = APP_MANAGE_TOOLS.map(tool => tool.descriptor.name)
