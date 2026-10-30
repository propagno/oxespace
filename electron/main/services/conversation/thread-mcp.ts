import { agentMcpArguments } from '../agent-launch.service'
import { claudeMcpEntries, codexMcpArguments, type ManagedMcp } from './thread-managed-mcp'
import { matchesResource } from '../../../../shared/policy'
import type { ConversationThread, AgentConversationAdapter, ThreadEvent, ThreadPermissionRule, ThreadSnapshot } from '../../../../shared/types/thread'

export interface ThreadMcpBindings {
  bridge: string
  prepare(thread: ConversationThread): Promise<Record<string, string>>
  end(threadId: string, executionId?: string): void
  observed?(thread: ConversationThread): void
  memoryEvent?(snapshot: ThreadSnapshot, event: ThreadEvent): void
}

// Thread receives the OXESpace tools that work from a conversation. Tools that
// operate on Code panes, scripts, background jobs or worktrees of a Code
// workspace are not offered: listing a tool an agent can never call successfully
// only wastes its turns. Provider permission requests remain enabled, so
// mutating calls are reviewed in the conversation.
//
// Every tool definition the bridge lists is sent with every model request, so a
// conversation gets only the core group, the groups its role needs, and the
// groups the project turns on with `thread.tools` in oxe.yaml.
export const THREAD_TOOL_GROUPS = {
  /** Every conversation: code, search and memory lookups. */
  core: ['oxespace_capabilities', 'oxespace_project_context', 'oxespace_memory_search', 'oxespace_memory_remember',
    'oxespace_semantic_search', 'oxespace_hybrid_explore',
    'oxespace_code_search', 'oxespace_code_callers', 'oxespace_code_callees', 'oxespace_code_impact', 'oxespace_code_node', 'oxespace_code_status'],
  /** A team member's conversation. */
  team: ['oxespace_team_status', 'oxespace_team_inbox', 'oxespace_team_message', 'oxespace_team_acknowledge'],
  /** A conversation that runs a delegation or an Agent Work task, or supervises a Work run. */
  worker: ['oxespace_execution_context', 'oxespace_delegation_context', 'oxespace_delegation_update', 'oxespace_delegation_checkpoint',
    'oxespace_delegation_message', 'oxespace_delegation_inbox', 'oxespace_delegation_acknowledge', 'oxespace_delegation_result',
    'oxespace_delegation_status', 'oxespace_work_status', 'oxespace_work_result', 'oxespace_work_message', 'oxespace_work_cancel'],
  /** Starting other agents and conversations. */
  orchestration: ['oxespace_list_agents', 'oxespace_list_workspaces', 'oxespace_delegation_targets', 'oxespace_delegation_preflight',
    'oxespace_delegate_task', 'oxespace_delegation_status', 'oxespace_delegation_inbox', 'oxespace_delegation_result', 'oxespace_delegation_control',
    'oxespace_work_plan', 'oxespace_work_status', 'oxespace_work_result', 'oxespace_work_message', 'oxespace_work_cancel',
    'oxespace_thread_create', 'oxespace_thread_send', 'oxespace_thread_read',
    'oxespace_memory_sessions', 'oxespace_memory_handoffs', 'oxespace_memory_accept_handoff', 'oxespace_quality_check'],
  /** Database and container access; every data read and change is approved by a person inside OxeQuery. */
  data: ['oxespace_db_connections', 'oxespace_db_describe', 'oxespace_db_query', 'oxespace_mongo_find', 'oxespace_mongo_aggregate',
    'oxespace_db_execute', 'oxespace_mongo_write', 'oxespace_containers_list', 'oxespace_container_logs', 'oxespace_container_action',
    'oxespace_db_explain', 'oxespace_db_activity'],
  /** Web previews and documentation captures. */
  docs: ['oxespace_open_web_preview', 'oxespace_capture_web_preview', 'oxespace_preview_interact',
    'oxespace_documentation_create', 'oxespace_documentation_get', 'oxespace_documentation_list', 'oxespace_documentation_capture',
    'oxespace_documentation_checkpoint', 'oxespace_documentation_image', 'oxespace_documentation_export'],
  /** The app itself: Git, GitHub, Threads, skills, automations, Linear, MCP servers, search and usage.
   * Changes: each action is recorded; pushes, pull requests, releases and the like are approved by a person. */
  app: ['oxespace_git', 'oxespace_github', 'oxespace_threads', 'oxespace_skills', 'oxespace_automations', 'oxespace_linear',
    'oxespace_mcp_servers', 'oxespace_search', 'oxespace_usage', 'oxespace_settings', 'oxespace_diagnostics',
    'oxespace_git_change', 'oxespace_github_change', 'oxespace_threads_change', 'oxespace_skills_change', 'oxespace_automations_change',
    'oxespace_workspace_change', 'oxespace_mcp_servers_change']
} as const satisfies Record<string, readonly string[]>

export type ThreadToolGroup = keyof typeof THREAD_TOOL_GROUPS
/** Groups a project can turn on in oxe.yaml; core is always on and roles are detected. */
export const OPTIONAL_THREAD_TOOL_GROUPS: ThreadToolGroup[] = ['orchestration', 'data', 'docs', 'app']

/** Every tool a Thread can be given. */
export const THREAD_MCP_TOOLS: string[] = [...new Set(Object.values(THREAD_TOOL_GROUPS).flat())]

/**
 * What a read-only conversation may call: lookups and status only. Nothing
 * here writes to the project, starts work or sends messages, so a read-only
 * Thread can still search code, memory and documentation.
 */
export const THREAD_READ_ONLY_MCP_TOOLS = ['oxespace_capabilities', 'oxespace_execution_context', 'oxespace_project_context',
  'oxespace_memory_search', 'oxespace_memory_sessions', 'oxespace_memory_handoffs',
  'oxespace_semantic_search', 'oxespace_hybrid_explore', 'oxespace_list_agents', 'oxespace_list_workspaces', 'oxespace_git',
  'oxespace_github', 'oxespace_threads', 'oxespace_skills', 'oxespace_automations', 'oxespace_linear', 'oxespace_mcp_servers', 'oxespace_search', 'oxespace_usage', 'oxespace_settings', 'oxespace_diagnostics',
  'oxespace_code_search', 'oxespace_code_callers', 'oxespace_code_callees', 'oxespace_code_impact', 'oxespace_code_node', 'oxespace_code_status',
  'oxespace_documentation_get', 'oxespace_documentation_list', 'oxespace_thread_read', 'oxespace_work_status', 'oxespace_work_result',
  'oxespace_team_status', 'oxespace_team_inbox', 'oxespace_delegation_status', 'oxespace_delegation_inbox', 'oxespace_delegation_result']

/** The role a conversation has when it starts, which decides the groups it needs. */
export interface ThreadToolRoles { team?: boolean; worker?: boolean }

/** The tools a conversation gets: core, the groups of its roles, and the groups its project turned on. */
export function threadToolList(roles: ThreadToolRoles = {}, optIn: readonly string[] = []): string[] {
  const groups: ThreadToolGroup[] = ['core', ...(roles.team ? ['team' as const] : []), ...(roles.worker ? ['worker' as const] : []),
    ...OPTIONAL_THREAD_TOOL_GROUPS.filter(group => optIn.includes(group))]
  return [...new Set(groups.flatMap(group => THREAD_TOOL_GROUPS[group]))]
}

interface RoleDatabase { prepare(sql: string): { get(...params: unknown[]): unknown } }

/** Team membership, a delegation or Work task this conversation runs, or a Work run it supervises. */
export function threadToolRoles(db: RoleDatabase, threadId: string): ThreadToolRoles {
  const has = (sql: string): boolean => { try { return Boolean(db.prepare(sql).get(threadId)) } catch { return false } }
  return {
    team: has(`SELECT 1 FROM agent_team_execution_links l JOIN agent_team_members m ON m.id=l.member_id
      WHERE l.owner_kind='thread' AND l.owner_id=? AND m.archived=0 LIMIT 1`),
    worker: has("SELECT 1 FROM delegations WHERE json_extract(payload, '$.destinationThreadId')=? LIMIT 1")
      || has('SELECT 1 FROM work_tasks WHERE thread_id=? LIMIT 1')
      || has('SELECT 1 FROM work_runs WHERE supervisor_thread_id=? LIMIT 1')
  }
}

/**
 * Claude loads an MCP tool's definition only when it needs it, instead of
 * sending every definition with every request, once they pass 5% of the
 * context. A value the person set is kept.
 */
export function toolSearchEnvironment(provider: 'claude' | 'codex', source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return provider === 'claude' && source.ENABLE_TOOL_SEARCH === undefined ? { ENABLE_TOOL_SEARCH: 'auto:5' } : {}
}

/** The empty strict configuration Claude receives for a read-only conversation. */
const READ_ONLY_EMPTY_MCP = '{"mcpServers":{}}'

/** An MCP tool a deny rule removes before the session starts; `tool` is `*` for a whole server. */
export interface DeniedMcpTool { server: string; tool: string }

/** Deny rules of kind `tool` (`server/tool` or `server/*`) as launch exclusions. */
export function deniedMcpTools(rules: Pick<ThreadPermissionRule, 'kind' | 'decision' | 'pattern'>[]): DeniedMcpTool[] {
  return rules.filter(rule => rule.kind === 'tool' && rule.decision === 'deny').map(rule => {
    const [server, tool] = rule.pattern.split('/')
    return { server, tool }
  }).filter(rule => rule.server && rule.tool)
}

/**
 * Claude hides denied tools with --disallowedTools (`mcp__server` for a whole
 * server). Codex can only be told about servers OXESpace itself attaches, so
 * the exclusion reaches the OXESpace bridge and managed servers; the approval
 * policy still declines the rest when the provider asks.
 */
function exclusionArguments(provider: 'claude' | 'codex', denied: DeniedMcpTool[], codexServers: string[], deniedTools: readonly string[] = [], tools: readonly string[] = []): string[] {
  const byPolicy = policyExclusions(deniedTools, tools)
  if (provider === 'claude') {
    // Built-in tools a policy denies by name join the MCP exclusions in the one flag Claude reads.
    const names = [...new Set([...[...denied, ...byPolicy.mcp].map(rule => rule.tool === '*' ? `mcp__${rule.server}` : `mcp__${rule.server}__${rule.tool}`), ...byPolicy.builtIn])]
    return names.length ? ['--disallowedTools', names.join(',')] : []
  }
  // Codex has no flag for names: MCP tools a policy denies join the per-server exclusions.
  if (!denied.length && !byPolicy.mcp.length) return []
  const out: string[] = []
  for (const server of codexServers) {
    const rules = [...denied, ...byPolicy.mcp].filter(rule => rule.server === server)
    if (rules.some(rule => rule.tool === '*')) out.push('-c', `mcp_servers.${server}.enabled=false`)
    else if (rules.length) out.push('-c', `mcp_servers.${server}.disabled_tools=${JSON.stringify([...new Set(rules.map(rule => rule.tool))])}`)
  }
  return out
}

/**
 * Splits the tool names a policy denies into built-in names (Claude only) and per-server MCP rules, matched the way
 * Claude and `tools/call` match them: a whole server (`mcp__github`, `mcp__github__*`) or one tool. The OXESpace server
 * also answers to `oxespace`, its key in Code terminals, and a partial wildcard over its tools (`mcp__oxespace__oxespace_db_*`)
 * is resolved against the tools this conversation offers. Another server's partial wildcard is left to approvals,
 * since its tools are not known at launch.
 */
function policyExclusions(deniedTools: readonly string[], tools: readonly string[]): { builtIn: string[]; mcp: DeniedMcpTool[] } {
  const builtIn: string[] = [], mcp: DeniedMcpTool[] = []
  for (const name of deniedTools) {
    const match = /^mcp__(.+?)(?:__(.+))?$/i.exec(name)
    if (!match) { builtIn.push(name); continue }
    if (match[1].includes('*')) continue
    const server = match[1].toLowerCase() === 'oxespace' ? 'oxespace-delegation' : match[1]
    const tool = match[2] ?? '*'
    if (tool === '*' || !tool.includes('*')) mcp.push({ server, tool })
    else if (server === 'oxespace-delegation') for (const known of tools) if (matchesResource(tool, known)) mcp.push({ server, tool: known })
  }
  return { builtIn, mcp }
}

export function threadMcpArguments(provider: 'claude' | 'codex', args: string[], bridge: string, managed?: ManagedMcp, denied: DeniedMcpTool[] = [],
  tools: readonly string[] = THREAD_MCP_TOOLS, deniedTools: readonly string[] = []): string[] {
  if (provider === 'claude' && args.includes('--strict-mcp-config')) {
    // A read-only conversation keeps its strict surface (no user servers, which
    // may write), but gets the OXESpace bridge limited to read-only lookups.
    const index = args.indexOf('--mcp-config')
    if (index < 0 || args[index + 1] !== READ_ONLY_EMPTY_MCP) return args
    const readOnly = [...args]
    const lookups = THREAD_READ_ONLY_MCP_TOOLS.filter(tool => tools.includes(tool))
    readOnly[index + 1] = JSON.stringify({ mcpServers: { 'oxespace-delegation': { command: 'node', args: [bridge, '--allowed-tools', JSON.stringify(lookups)] } } })
    return [...readOnly, ...exclusionArguments(provider, denied, [], deniedTools, lookups)]
  }
  const config = agentMcpArguments(provider, bridge)
  const bridgeArgs = [bridge, '--allowed-tools', JSON.stringify(tools)]
  if (provider === 'codex') {
    config[3] = `mcp_servers.oxespace-delegation.args=${JSON.stringify(bridgeArgs)}`
    return [...config, ...(managed ? codexMcpArguments(managed) : []), ...exclusionArguments(provider, denied, ['oxespace-delegation', ...(managed?.servers.map(server => server.key) ?? [])], deniedTools, tools), ...args]
  }
  const clean = args.filter((arg, i) => !['--mcp-config', '--strict-mcp-config'].includes(arg) && args[i - 1] !== '--mcp-config')
  // Keep Claude's user and project MCP configuration. The extra config adds
  // the OXESpace bridge without replacing servers already available in the CLI.
  return [...clean, '--mcp-config', JSON.stringify({ mcpServers: {
    ...(managed ? claudeMcpEntries(managed) : {}),
    'oxespace-delegation': { command: 'node', args: bridgeArgs }
  } }), ...exclusionArguments(provider, denied, [], deniedTools, tools)]
}

export function bindThreadMcp(adapter: AgentConversationAdapter, release: () => void): AgentConversationAdapter {
  const dispose = adapter.dispose.bind(adapter)
  let released = false
  adapter.dispose = async () => {
    try { await dispose() } finally { if (!released) { released = true; release() } }
  }
  return adapter
}
