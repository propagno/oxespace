import { agentMcpArguments } from '../agent-launch.service'
import { claudeMcpEntries, codexMcpArguments, type ManagedMcp } from './thread-managed-mcp'
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
export const THREAD_MCP_TOOLS = ['oxespace_team_status', 'oxespace_team_inbox', 'oxespace_team_message', 'oxespace_team_acknowledge', 'oxespace_memory_search', 'oxespace_memory_remember', 'oxespace_memory_sessions',
  'oxespace_memory_handoffs', 'oxespace_memory_accept_handoff', 'oxespace_project_context',
  'oxespace_capabilities', 'oxespace_execution_context', 'oxespace_list_agents', 'oxespace_list_workspaces',
  'oxespace_semantic_search', 'oxespace_hybrid_explore', 'oxespace_quality_check', 'oxespace_git',
  'oxespace_github', 'oxespace_threads', 'oxespace_skills', 'oxespace_automations', 'oxespace_linear', 'oxespace_mcp_servers', 'oxespace_search', 'oxespace_usage',
  // Changes: each action is recorded; pushes, pull requests, releases and the like are approved by a person.
  'oxespace_git_change', 'oxespace_github_change', 'oxespace_threads_change',
  'oxespace_code_search', 'oxespace_code_callers', 'oxespace_code_callees', 'oxespace_code_impact', 'oxespace_code_node', 'oxespace_code_status',
  'oxespace_open_web_preview', 'oxespace_capture_web_preview',
  'oxespace_thread_create', 'oxespace_thread_send', 'oxespace_thread_read',
  'oxespace_work_plan', 'oxespace_work_status', 'oxespace_work_result', 'oxespace_work_message', 'oxespace_work_cancel',
  'oxespace_preview_interact', 'oxespace_documentation_create', 'oxespace_documentation_get', 'oxespace_documentation_list',
  'oxespace_documentation_capture', 'oxespace_documentation_checkpoint', 'oxespace_documentation_image', 'oxespace_documentation_export',
  'oxespace_delegation_targets', 'oxespace_delegation_preflight', 'oxespace_delegate_task', 'oxespace_delegation_status',
  'oxespace_delegation_inbox', 'oxespace_delegation_acknowledge', 'oxespace_delegation_context', 'oxespace_delegation_result',
  'oxespace_delegation_message', 'oxespace_delegation_control', 'oxespace_delegation_update', 'oxespace_delegation_checkpoint',
  // Database and container access; every data read and change is approved by a person inside OxeQuery.
  'oxespace_db_connections', 'oxespace_db_describe', 'oxespace_db_query', 'oxespace_mongo_find', 'oxespace_mongo_aggregate',
  'oxespace_db_execute', 'oxespace_mongo_write', 'oxespace_containers_list', 'oxespace_container_logs', 'oxespace_container_action']

/**
 * What a read-only conversation may call: lookups and status only. Nothing
 * here writes to the project, starts work or sends messages, so a read-only
 * Thread can still search code, memory and documentation.
 */
export const THREAD_READ_ONLY_MCP_TOOLS = ['oxespace_capabilities', 'oxespace_execution_context', 'oxespace_project_context',
  'oxespace_memory_search', 'oxespace_memory_sessions', 'oxespace_memory_handoffs',
  'oxespace_semantic_search', 'oxespace_hybrid_explore', 'oxespace_list_agents', 'oxespace_list_workspaces', 'oxespace_git',
  'oxespace_github', 'oxespace_threads', 'oxespace_skills', 'oxespace_automations', 'oxespace_linear', 'oxespace_mcp_servers', 'oxespace_search', 'oxespace_usage',
  'oxespace_code_search', 'oxespace_code_callers', 'oxespace_code_callees', 'oxespace_code_impact', 'oxespace_code_node', 'oxespace_code_status',
  'oxespace_documentation_get', 'oxespace_documentation_list', 'oxespace_thread_read', 'oxespace_work_status', 'oxespace_work_result',
  'oxespace_team_status', 'oxespace_team_inbox', 'oxespace_delegation_status', 'oxespace_delegation_inbox', 'oxespace_delegation_result']

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
function exclusionArguments(provider: 'claude' | 'codex', denied: DeniedMcpTool[], codexServers: string[]): string[] {
  if (!denied.length) return []
  if (provider === 'claude') return ['--disallowedTools', denied.map(rule => rule.tool === '*' ? `mcp__${rule.server}` : `mcp__${rule.server}__${rule.tool}`).join(',')]
  const out: string[] = []
  for (const server of codexServers) {
    const rules = denied.filter(rule => rule.server === server)
    if (rules.some(rule => rule.tool === '*')) out.push('-c', `mcp_servers.${server}.enabled=false`)
    else if (rules.length) out.push('-c', `mcp_servers.${server}.disabled_tools=${JSON.stringify(rules.map(rule => rule.tool))}`)
  }
  return out
}

export function threadMcpArguments(provider: 'claude' | 'codex', args: string[], bridge: string, managed?: ManagedMcp, denied: DeniedMcpTool[] = []): string[] {
  if (provider === 'claude' && args.includes('--strict-mcp-config')) {
    // A read-only conversation keeps its strict surface (no user servers, which
    // may write), but gets the OXESpace bridge limited to read-only lookups.
    const index = args.indexOf('--mcp-config')
    if (index < 0 || args[index + 1] !== READ_ONLY_EMPTY_MCP) return args
    const readOnly = [...args]
    readOnly[index + 1] = JSON.stringify({ mcpServers: { 'oxespace-delegation': { command: 'node', args: [bridge, '--allowed-tools', JSON.stringify(THREAD_READ_ONLY_MCP_TOOLS)] } } })
    return [...readOnly, ...exclusionArguments(provider, denied, [])]
  }
  const config = agentMcpArguments(provider, bridge)
  const bridgeArgs = [bridge, '--allowed-tools', JSON.stringify(THREAD_MCP_TOOLS)]
  if (provider === 'codex') {
    config[3] = `mcp_servers.oxespace-delegation.args=${JSON.stringify(bridgeArgs)}`
    return [...config, ...(managed ? codexMcpArguments(managed) : []), ...exclusionArguments(provider, denied, ['oxespace-delegation', ...(managed?.servers.map(server => server.key) ?? [])]), ...args]
  }
  const clean = args.filter((arg, i) => !['--mcp-config', '--strict-mcp-config'].includes(arg) && args[i - 1] !== '--mcp-config')
  // Keep Claude's user and project MCP configuration. The extra config adds
  // the OXESpace bridge without replacing servers already available in the CLI.
  return [...clean, '--mcp-config', JSON.stringify({ mcpServers: {
    ...(managed ? claudeMcpEntries(managed) : {}),
    'oxespace-delegation': { command: 'node', args: bridgeArgs }
  } }), ...exclusionArguments(provider, denied, [])]
}

export function bindThreadMcp(adapter: AgentConversationAdapter, release: () => void): AgentConversationAdapter {
  const dispose = adapter.dispose.bind(adapter)
  let released = false
  adapter.dispose = async () => {
    try { await dispose() } finally { if (!released) { released = true; release() } }
  }
  return adapter
}
