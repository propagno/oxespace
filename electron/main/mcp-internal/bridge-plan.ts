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

export function bridgePlanFlags(plan: BridgePlan): string[] {
  return ['--allowed-tools', JSON.stringify(plan.tools), ...(Object.keys(plan.enableable).length ? ['--enableable-groups', JSON.stringify(plan.enableable)] : [])]
}
