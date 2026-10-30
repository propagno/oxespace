import type { AppDatabase } from '../db'
import { CONFIGURABLE_MCP_TOOL_GROUPS, estimateTokens, MCP_TOOL_GROUP_IDS, type ConfigurableMcpToolGroup, type McpToolCost, type McpToolGroupInfo, type McpToolGroupMode, type McpToolGroupsReport } from '../../../shared/types/mcp-tools'
import type { FileSystemService } from './file-system.service'
import { MCP_TOOL_GROUPS } from './conversation/thread-mcp'
import { projectToolModes } from './conversation/tool-groups'
import { ThreadPermissionStore } from './conversation/thread-permissions'
import { loadRepoConfig } from './repo-config/loader'
import { OXE_YAML_FILE } from './repo-config/parser'
import { withToolMode } from './repo-config/tool-modes-writer'

const cost = (chars: number): McpToolCost => ({ chars, tokens: estimateTokens(chars) })

/** Settings › Tools (F10): each group, its mode in the project and what it costs, measured like the CI budget (T8). */
export async function toolGroupsReport(rootPath: string | null): Promise<McpToolGroupsReport> {
  const [{ TOOL_REGISTRY }, { toolDefinitionChars, toolNameChars }] = await Promise.all([import('../mcp-internal/tool-registry'), import('../mcp-internal/tool-cost')])
  const modes = projectToolModes(rootPath ? (await loadRepoConfig(rootPath))?.thread : undefined)
  const groups = MCP_TOOL_GROUP_IDS.map((id): McpToolGroupInfo => {
    const tools = [...MCP_TOOL_GROUPS[id]]
    const configurable = (CONFIGURABLE_MCP_TOOL_GROUPS as readonly string[]).includes(id)
    const project = configurable ? modes[id as ConfigurableMcpToolGroup] : undefined
    const loaded = toolDefinitionChars(TOOL_REGISTRY, tools)
    return {
      id, tools, configurable,
      mode: project?.mode ?? 'always',
      source: id === 'team' || id === 'worker' || id === 'code' ? 'role' : project?.source ?? 'default',
      cost: { claude: { loaded: cost(loaded), deferred: cost(toolNameChars(tools)) }, codex: { loaded: cost(loaded) } }
    }
  })
  const core = groups.find(group => group.id === 'core')!.cost.claude.loaded.chars
  const offered = (all: boolean) => groups.filter(group => group.configurable && (all || group.mode !== 'off'))
    .reduce((sum, group) => sum + (group.mode === 'always' && !all ? group.cost.claude.loaded.chars : group.cost.claude.deferred.chars), 0)
  return { rootPath, groups, totals: { plainConversation: cost(core + offered(false)), everythingOnDemand: cost(core + offered(true)) } }
}

/** The workspace id the file service accepts for a registered project root: a Code workspace or an OXESpace conversation project. */
export function registeredProject(db: AppDatabase, rootPath: string): string | null {
  const workspace = db.prepare('SELECT id FROM workspaces WHERE root_path = ?').get(rootPath) as { id: string } | undefined
  if (workspace) return workspace.id
  const project = db.prepare('SELECT project_id FROM thread_project_contexts WHERE root_path = ?').get(rootPath) as { project_id: string } | undefined
  return project ? `thread:${project.project_id}` : null
}

/**
 * Writes one group's mode to the project's oxe.yaml through the file service (inside the registered root only), and
 * records it in the project's audit. The person's choice, from the app's window only.
 */
export async function setToolGroupMode(db: AppDatabase, files: FileSystemService, input: { rootPath: string; group: ConfigurableMcpToolGroup; mode: McpToolGroupMode }): Promise<McpToolGroupsReport> {
  const workspaceId = registeredProject(db, input.rootPath)
  if (!workspaceId) throw new Error('This folder is not a project OXESpace knows')
  const target = { workspaceId, rootPath: input.rootPath, relativePath: OXE_YAML_FILE }
  const existing = await files.readFile(target).then(file => file.content, (error: NodeJS.ErrnoException) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  const content = withToolMode(existing, input.group, input.mode)
  await (existing === null ? files.createFile({ ...target, content }) : files.writeFile({ ...target, content }))
  new ThreadPermissionStore(db).audit({ projectRoot: input.rootPath, action: 'configuration', actor: 'user', summary: `Set the ${input.group} tool group to ${input.mode}` })
  return toolGroupsReport(input.rootPath)
}
