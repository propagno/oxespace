import { agentMcpArguments } from '../agent-launch.service'
import { claudeMcpEntries, codexMcpArguments, type ManagedMcp } from './thread-managed-mcp'
import type { ConversationThread, AgentConversationAdapter, ThreadEvent, ThreadSnapshot } from '../../../../shared/types/thread'

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
  'oxespace_semantic_search', 'oxespace_hybrid_explore', 'oxespace_quality_check',
  'oxespace_code_search', 'oxespace_code_callers', 'oxespace_code_callees', 'oxespace_code_impact', 'oxespace_code_node', 'oxespace_code_status',
  'oxespace_open_web_preview', 'oxespace_capture_web_preview',
  'oxespace_thread_create', 'oxespace_thread_send', 'oxespace_thread_read',
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
  'oxespace_semantic_search', 'oxespace_hybrid_explore', 'oxespace_list_agents', 'oxespace_list_workspaces',
  'oxespace_code_search', 'oxespace_code_callers', 'oxespace_code_callees', 'oxespace_code_impact', 'oxespace_code_node', 'oxespace_code_status',
  'oxespace_documentation_get', 'oxespace_documentation_list', 'oxespace_thread_read',
  'oxespace_team_status', 'oxespace_team_inbox', 'oxespace_delegation_status', 'oxespace_delegation_inbox', 'oxespace_delegation_result']

/** The empty strict configuration Claude receives for a read-only conversation. */
const READ_ONLY_EMPTY_MCP = '{"mcpServers":{}}'

export function threadMcpArguments(provider: 'claude' | 'codex', args: string[], bridge: string, managed?: ManagedMcp): string[] {
  if (provider === 'claude' && args.includes('--strict-mcp-config')) {
    // A read-only conversation keeps its strict surface (no user servers, which
    // may write), but gets the OXESpace bridge limited to read-only lookups.
    const index = args.indexOf('--mcp-config')
    if (index < 0 || args[index + 1] !== READ_ONLY_EMPTY_MCP) return args
    const readOnly = [...args]
    readOnly[index + 1] = JSON.stringify({ mcpServers: { 'oxespace-delegation': { command: 'node', args: [bridge, '--allowed-tools', JSON.stringify(THREAD_READ_ONLY_MCP_TOOLS)] } } })
    return readOnly
  }
  const config = agentMcpArguments(provider, bridge)
  const bridgeArgs = [bridge, '--allowed-tools', JSON.stringify(THREAD_MCP_TOOLS)]
  if (provider === 'codex') {
    config[3] = `mcp_servers.oxespace-delegation.args=${JSON.stringify(bridgeArgs)}`
    return [...config, ...(managed ? codexMcpArguments(managed) : []), ...args]
  }
  const clean = args.filter((arg, i) => !['--mcp-config', '--strict-mcp-config'].includes(arg) && args[i - 1] !== '--mcp-config')
  // Keep Claude's user and project MCP configuration. The extra config adds
  // the OXESpace bridge without replacing servers already available in the CLI.
  return [...clean, '--mcp-config', JSON.stringify({ mcpServers: {
    ...(managed ? claudeMcpEntries(managed) : {}),
    'oxespace-delegation': { command: 'node', args: bridgeArgs }
  } })]
}

export function bindThreadMcp(adapter: AgentConversationAdapter, release: () => void): AgentConversationAdapter {
  const dispose = adapter.dispose.bind(adapter)
  let released = false
  adapter.dispose = async () => {
    try { await dispose() } finally { if (!released) { released = true; release() } }
  }
  return adapter
}
