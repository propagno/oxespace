/**
 * What a read-only conversation may call: lookups and status only. Nothing
 * here writes to the project, starts work or sends messages, so a read-only
 * Thread can still search the project. Kept apart from
 * thread-mcp.ts so the pure permission kernel reads it without the launch code.
 */
export const THREAD_READ_ONLY_MCP_TOOLS = ['oxespace_capabilities', 'oxespace_execution_context', 'oxespace_project_context',
  'oxespace_list_agents', 'oxespace_list_workspaces', 'oxespace_git',
  'oxespace_github', 'oxespace_threads', 'oxespace_skills', 'oxespace_mcp_servers', 'oxespace_search', 'oxespace_usage', 'oxespace_settings', 'oxespace_diagnostics',
  'oxespace_thread_read', 'oxespace_work_status', 'oxespace_work_result',
  'oxespace_delegation_status', 'oxespace_delegation_inbox', 'oxespace_delegation_result']

/** The key OXESpace's own tools have in a conversation (mcp-tool-rules.ts OXESPACE_MCP_SERVER). */
export const OXESPACE_BRIDGE_KEY = 'oxespace-delegation'

/**
 * T53: the lookups "Auto-approve reads" approves with no rule. Like the shell list, which stops at the project's
 * folder, only reads of this project: search, context, Git history, and the
 * conversations and work it started. Left out, so they still ask (SECURITY #547 M1): what reads the person's other
 * projects or the whole app (workspaces, agents, skills, MCP servers, settings,
 * usage, diagnostics), what reads an account over the network (GitHub), the team's messages, and the
 * delegation lookups, which also record the waiting executor.
 */
export const AUTO_APPROVED_LOOKUPS = [
  'oxespace_capabilities', 'oxespace_execution_context', 'oxespace_project_context',
  'oxespace_search', 'oxespace_git', 'oxespace_threads',
  'oxespace_thread_read', 'oxespace_work_status', 'oxespace_work_result'
] as const satisfies readonly (typeof THREAD_READ_ONLY_MCP_TOOLS)[number][]

const AUTO = new Set<string>(AUTO_APPROVED_LOOKUPS)

/**
 * Whether "Auto-approve reads" approves this call with no rule: one of the lookups above, from OXESpace's own server.
 * Server and name together, never the name alone: another server's tool of the same name still asks.
 */
export function isOxespaceReadOnlyTool(server: string, tool: string): boolean {
  return server === OXESPACE_BRIDGE_KEY && AUTO.has(tool)
}
