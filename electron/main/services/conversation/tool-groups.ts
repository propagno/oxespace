import { CONFIGURABLE_MCP_TOOL_GROUPS, MCP_TOOL_GROUP_MODES, type ConfigurableMcpToolGroup, type McpToolGroupMode } from '../../../../shared/types/mcp-tools'
import type { RepoConfig } from '../../../../shared/types/repo-config'
import { MCP_TOOL_GROUPS, type ThreadToolRoles } from './thread-mcp'

/** Each configurable group's mode in a project, and whether the project set it. */
export type ProjectToolModes = Record<ConfigurableMcpToolGroup, { mode: McpToolGroupMode; source: 'default' | 'project' }>

const isConfigurable = (group: string): group is ConfigurableMcpToolGroup => (CONFIGURABLE_MCP_TOOL_GROUPS as readonly string[]).includes(group)
const isMode = (mode: unknown): mode is McpToolGroupMode => (MCP_TOOL_GROUP_MODES as readonly unknown[]).includes(mode)

/**
 * `thread.tools` in oxe.yaml, in either form: a list of groups (the 1.3 form: those are always on) or a map of group to
 * mode. Anything not named is on demand; unknown groups and modes are ignored.
 */
export function projectToolModes(thread: RepoConfig['thread'] | undefined): ProjectToolModes {
  const modes = Object.fromEntries(CONFIGURABLE_MCP_TOOL_GROUPS.map(group => [group, { mode: 'on-demand', source: 'default' }])) as ProjectToolModes
  for (const group of thread?.tools ?? []) if (isConfigurable(group)) modes[group] = { mode: 'always', source: 'project' }
  for (const [group, mode] of Object.entries(thread?.toolModes ?? {})) if (isConfigurable(group) && isMode(mode)) modes[group] = { mode, source: 'project' }
  return modes
}

/** Turns a group on for the session; answered by the bridge, which owns the session's tool list. */
export const TOOLS_ENABLE = 'oxespace_tools_enable'

export interface SessionToolPlan {
  /** The tools the session is offered when it starts. */
  tools: string[]
  /** Groups the session may turn on with oxespace_tools_enable, with their tools. */
  enableable: Partial<Record<ConfigurableMcpToolGroup, string[]>>
}

/**
 * What a session is offered (B7.2): an OxeChat conversation, or with `code` an agent in a Code terminal (B2.2). Core
 * and the role's groups always; then each configurable group by its mode.
 * With tool search (Claude unless the person turned it off), every group that is not off is offered and Claude loads a
 * definition only when it searches for it, so the fixed cost is the names; Codex loads them as it needs them too.
 * Without it (Claude with `auto:N` or tool search off), `always` groups are offered and `on-demand` ones wait for
 * oxespace_tools_enable. `off` is never offered.
 */
export function sessionToolPlan(toolSearch: boolean, roles: ThreadToolRoles & { code?: boolean }, modes: ProjectToolModes): SessionToolPlan {
  const groups: (keyof typeof MCP_TOOL_GROUPS)[] = ['core', ...(roles.code ? ['code' as const] : []), ...(roles.team ? ['team' as const] : []), ...(roles.worker ? ['worker' as const] : []),
    // The project's coordinator conversation (B1.4): its role adds its own group; orchestration follows the project's
    // mode like any group, so a project that turns it off keeps it off for the coordinator too (SECURITY M-2).
    ...(roles.coordinator ? ['coordinator' as const] : [])]
  const enableable: SessionToolPlan['enableable'] = {}
  for (const group of CONFIGURABLE_MCP_TOOL_GROUPS) {
    if (groups.includes(group)) continue
    const { mode } = modes[group]
    if (mode === 'always' || (mode === 'on-demand' && toolSearch)) groups.push(group)
    else if (mode === 'on-demand') enableable[group] = [...MCP_TOOL_GROUPS[group]]
  }
  const tools = [...new Set(groups.flatMap(group => MCP_TOOL_GROUPS[group]))]
  // Offered only when there is something to turn on, so a conversation that has nothing to enable pays nothing for it.
  return { tools: Object.keys(enableable).length ? [...tools, TOOLS_ENABLE] : tools, enableable }
}

/**
 * The OXESpace tools the workspace's `.mcp.json` offers (any agent started there, whatever its role): every group but
 * those the project turned off. `null` when none is off, so the entry stays as it was and offers every tool.
 */
export function projectOfferedTools(modes: ProjectToolModes): string[] | null {
  if (!CONFIGURABLE_MCP_TOOL_GROUPS.some(group => modes[group].mode === 'off')) return null
  const groups = (Object.keys(MCP_TOOL_GROUPS) as (keyof typeof MCP_TOOL_GROUPS)[])
    .filter(group => !(CONFIGURABLE_MCP_TOOL_GROUPS as readonly string[]).includes(group) || modes[group as ConfigurableMcpToolGroup].mode !== 'off')
  return [...new Set(groups.flatMap(group => MCP_TOOL_GROUPS[group]))]
}

/**
 * Whether the provider loads MCP definitions only when it needs them, so every group that is not off can be offered
 * at no fixed cost (measured in T8, docs/validation/tool-groups-cost-1.4.md).
 * - Codex (0.155.1) sends no MCP definitions up front, and does not reload its tool list mid-session, so a group must
 *   be offered from the start to work at all.
 * - Claude Code defers them for sure only with `ENABLE_TOOL_SEARCH=true`: `auto:N` defers only above N% of the context
 *   window, which a large window never reached, so it gets the plan without tool search.
 */
export function usesToolSearch(provider: 'claude' | 'codex', env: Record<string, string | undefined>): boolean {
  if (provider === 'codex') return true
  const value = env.ENABLE_TOOL_SEARCH?.trim().toLowerCase()
  return value === 'true' || value === '1'
}
