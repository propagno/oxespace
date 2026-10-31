/**
 * B7.2 · The OXESpace bridge's flags for a session's tool plan: the tools it offers now, and the groups it may turn on
 * later with oxespace_tools_enable. One helper for every way an agent reaches the bridge — an OxeChat conversation, an
 * agent started in a Code terminal, and the workspace's `.mcp.json` — so none of them offers more than its plan.
 * No imports: the main entry and every caller can take it without pulling the tool registry.
 */
export interface BridgePlan {
  tools: readonly string[]
  enableable: Readonly<Record<string, readonly string[]>>
}

/**
 * One OXESpace server per agent. The workspace's `.mcp.json` entry carries PROJECT_ENTRY_FLAG; an agent OXESpace starts
 * in a Code terminal with its own bridge (`--mcp-config`) also gets PANE_BRIDGE_ENV, a fresh token per launch. Claude
 * Code loads both servers, so the project entry that agent starts lists no tools, and the session pays for the OXESpace
 * tools once. A `claude` the agent starts itself inherits the token, but its entry serves as usual (oxespace-mcp.cjs).
 */
export const PROJECT_ENTRY_FLAG = '--project-entry'
export const PANE_BRIDGE_ENV = 'OXESPACE_PANE_BRIDGE'

export function bridgePlanFlags(plan: BridgePlan): string[] {
  return ['--allowed-tools', JSON.stringify(plan.tools), ...(Object.keys(plan.enableable).length ? ['--enableable-groups', JSON.stringify(plan.enableable)] : [])]
}
