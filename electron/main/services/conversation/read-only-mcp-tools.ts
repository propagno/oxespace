/**
 * What a read-only conversation may call: lookups and status only. Nothing
 * here writes to the project, starts work or sends messages, so a read-only
 * Thread can still search code, memory and documentation. Kept apart from
 * thread-mcp.ts so the pure permission kernel reads it without the launch code.
 */
export const THREAD_READ_ONLY_MCP_TOOLS = ['oxespace_capabilities', 'oxespace_execution_context', 'oxespace_project_context',
  'oxespace_memory_search', 'oxespace_memory_sessions', 'oxespace_memory_handoffs',
  'oxespace_semantic_search', 'oxespace_hybrid_explore', 'oxespace_list_agents', 'oxespace_list_workspaces', 'oxespace_git',
  'oxespace_github', 'oxespace_threads', 'oxespace_skills', 'oxespace_automations', 'oxespace_linear', 'oxespace_mcp_servers', 'oxespace_search', 'oxespace_usage', 'oxespace_settings', 'oxespace_diagnostics',
  'oxespace_code_search', 'oxespace_code_callers', 'oxespace_code_callees', 'oxespace_code_impact', 'oxespace_code_node', 'oxespace_code_status',
  'oxespace_documentation_get', 'oxespace_documentation_list', 'oxespace_thread_read', 'oxespace_work_status', 'oxespace_work_result',
  'oxespace_team_status', 'oxespace_team_inbox', 'oxespace_delegation_status', 'oxespace_delegation_inbox', 'oxespace_delegation_result']

/** The key OXESpace's own tools have in a conversation (mcp-tool-rules.ts OXESPACE_MCP_SERVER). */
export const OXESPACE_BRIDGE_KEY = 'oxespace-delegation'

const READ_ONLY = new Set<string>(THREAD_READ_ONLY_MCP_TOOLS)

/**
 * T53: a call that "Auto-approve reads" approves with no rule: one of the lookups above, from OXESpace's own server.
 * Server and name together, never the name alone: another server's tool of the same name still asks.
 */
export function isOxespaceReadOnlyTool(server: string, tool: string): boolean {
  return server === OXESPACE_BRIDGE_KEY && READ_ONLY.has(tool)
}
