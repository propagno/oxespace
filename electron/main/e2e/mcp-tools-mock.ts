/**
 * Settings › Tools in E2E runs: the real groups and modes, kept in memory per project, with fixed sizes in place of the
 * measured ones (the measurement needs the whole tool registry, which the mock chunk does not load).
 */
import { ipcMain } from 'electron'
import { MCP_TOOL_GROUPS } from '../services/conversation/thread-mcp'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import {
  CONFIGURABLE_MCP_TOOL_GROUPS, estimateTokens, MCP_TOOL_GROUP_IDS, MCP_TOOL_GROUP_MODES,
  MCP_TOOL_DECISIONS, type ConfigurableMcpToolGroup, type McpToolCost, type McpToolRule, type McpToolGroupInfo, type McpToolGroupMode, type McpToolGroupsReport
} from '../../../shared/types/mcp-tools'

const cost = (chars: number): McpToolCost => ({ chars, tokens: estimateTokens(chars) })

export function registerMcpToolsMock(): void {
  // B7.3: a user-level block the window cannot change, and whatever the spec sets per project.
  const rules = new Map<string, McpToolRule[]>()
  const rulesOf = (rootPath: string): McpToolRule[] => rules.get(rootPath) ?? [{ server: 'github', tool: 'delete_repository', decision: 'deny', source: 'user', editable: false, scope: 'everywhere' }]
  ipcMain.handle(IPC_CHANNELS.mcpInternal.toolRules, (_event, input: { rootPath?: unknown }) => {
    if (typeof input?.rootPath !== 'string' || !input.rootPath) throw new Error('Invalid project')
    return rulesOf(input.rootPath)
  })
  ipcMain.handle(IPC_CHANNELS.mcpInternal.setToolRule, (_event, input: { rootPath?: unknown; server?: unknown; tool?: unknown; decision?: unknown }) => {
    if (typeof input?.rootPath !== 'string' || !input.rootPath || typeof input.server !== 'string' || !input.server || typeof input.tool !== 'string' || !input.tool) throw new Error('Invalid tool rule')
    if (!(MCP_TOOL_DECISIONS as readonly unknown[]).includes(input.decision)) throw new Error('Invalid decision')
    const current = rulesOf(input.rootPath).filter(rule => !(rule.server === input.server && rule.tool === input.tool))
    if (input.decision !== 'ask') current.push({ server: input.server, tool: input.tool, decision: input.decision as McpToolRule['decision'], source: 'project', editable: true, scope: input.decision === 'deny' ? 'everywhere' : 'oxechat' })
    rules.set(input.rootPath, current)
    return current
  })
  const modes = new Map<string, Partial<Record<ConfigurableMcpToolGroup, McpToolGroupMode>>>()
  const report = (rootPath: string | null): McpToolGroupsReport => {
    const chosen = (rootPath && modes.get(rootPath)) || {}
    const groups = MCP_TOOL_GROUP_IDS.map((id): McpToolGroupInfo => {
      const tools = [...MCP_TOOL_GROUPS[id]]
      const configurable = (CONFIGURABLE_MCP_TOOL_GROUPS as readonly string[]).includes(id)
      const project = configurable ? chosen[id as ConfigurableMcpToolGroup] : undefined
      const mode: McpToolGroupMode = id === 'core' ? 'always' : project ?? 'on-demand'
      return {
        id, tools, mode, configurable, source: id === 'team' || id === 'worker' || id === 'code' ? 'role' : project ? 'project' : 'default',
        cost: { claude: { loaded: cost(tools.length * 600), deferred: cost(tools.join(' ').length) }, codex: { loaded: cost(tools.length * 600) } }
      }
    })
    const core = groups.find(group => group.id === 'core')!
    const deferred = groups.filter(group => group.configurable && group.mode === 'on-demand').reduce((sum, group) => sum + group.cost.claude.deferred.chars, 0)
    const everything = groups.filter(group => group.configurable).reduce((sum, group) => sum + group.cost.claude.deferred.chars, 0)
    return { rootPath, groups, totals: { plainConversation: cost(core.cost.claude.loaded.chars + deferred), everythingOnDemand: cost(core.cost.claude.loaded.chars + everything) } }
  }
  ipcMain.handle(IPC_CHANNELS.mcpInternal.toolGroups, (_event, input?: { rootPath?: unknown }) => {
    if (input?.rootPath !== undefined && (typeof input.rootPath !== 'string' || !input.rootPath)) throw new Error('Invalid project')
    return report(typeof input?.rootPath === 'string' ? input.rootPath : null)
  })
  ipcMain.handle(IPC_CHANNELS.mcpInternal.setToolGroupMode, (_event, input: { rootPath?: unknown; group?: unknown; mode?: unknown }) => {
    if (typeof input?.rootPath !== 'string' || !input.rootPath) throw new Error('Invalid project')
    if (!(CONFIGURABLE_MCP_TOOL_GROUPS as readonly unknown[]).includes(input.group)) throw new Error('This group cannot be changed')
    if (!(MCP_TOOL_GROUP_MODES as readonly unknown[]).includes(input.mode)) throw new Error('Invalid mode')
    modes.set(input.rootPath, { ...modes.get(input.rootPath), [input.group as ConfigurableMcpToolGroup]: input.mode as McpToolGroupMode })
    return report(input.rootPath)
  })
}
