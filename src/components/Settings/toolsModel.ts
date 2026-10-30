import { MCP_COVERAGE } from '../../../shared/mcp-coverage'
import type { PolicyRule, PolicySource, PolicyView } from '../../../shared/policy'
import type { McpToolCost, McpToolDecision, McpToolGroupInfo, McpToolRule } from '../../../shared/types/mcp-tools'

/** The key OXESpace's own MCP server has in tool rules. */
export const OXESPACE_SERVER = 'oxespace-delegation'

/**
 * OXESpace tools with an action of the confirm level: the person confirms each such call, so the contract refuses
 * `allow` for them and the page does not offer it.
 */
export const CONFIRM_LEVEL_TOOLS: ReadonlySet<string> = new Set(Object.values(MCP_COVERAGE).flatMap(capability =>
  'tools' in capability ? Object.entries(capability.tools).filter(([, level]) => level === 'confirm').map(([name]) => name.split('#')[0]) : []))

/** What Claude receives with every request for a group in its current mode; null when the group is off. */
export function claudeFixedCost(group: McpToolGroupInfo): McpToolCost | null {
  if (group.mode === 'off') return null
  return group.mode === 'always' ? group.cost.claude.loaded : group.cost.claude.deferred
}

/** One tool's rule: the one the contract returned, or the default (ask, editable in the project). */
export function ruleFor(rules: readonly McpToolRule[], server: string, tool: string): McpToolRule {
  return rules.find(rule => rule.server === server && rule.tool === tool)
    ?? { server, tool, decision: 'ask', source: 'default', editable: true, scope: null }
}

/** Decisions the page offers for one tool. */
export function decisionsFor(rule: McpToolRule): McpToolDecision[] {
  return rule.server === OXESPACE_SERVER && CONFIRM_LEVEL_TOOLS.has(rule.tool) && rule.decision !== 'allow' ? ['ask', 'deny'] : ['allow', 'ask', 'deny']
}

/** Rules for other MCP servers' tools, by server then tool. */
export function otherServerRules(rules: readonly McpToolRule[]): McpToolRule[] {
  return rules.filter(rule => rule.server !== OXESPACE_SERVER).sort((a, b) => a.server.localeCompare(b.server) || a.tool.localeCompare(b.tool))
}

/** The organization's rules about tools and MCP servers: the user and managed layers, read only. */
export function organizationToolRules(view: PolicyView | null): Array<{ source: PolicySource; rule: PolicyRule }> {
  if (!view) return []
  return view.sources.filter(source => source.layer !== 'project').flatMap(source => source.rules
    .filter(rule => rule.action === 'tool.use' || (rule.action === 'integration.use' && rule.resource.toLowerCase().startsWith('mcp:')))
    .map(rule => ({ source, rule })))
}
