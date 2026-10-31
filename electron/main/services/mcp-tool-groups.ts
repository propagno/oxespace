import type { AppDatabase } from '../db'
import { CONFIGURABLE_MCP_TOOL_GROUPS, estimateTokens, MCP_TOOL_GROUP_IDS, type ConfigurableMcpToolGroup, type McpToolCost, type McpToolGroupInfo, type McpToolGroupMode, type McpToolGroupsReport } from '../../../shared/types/mcp-tools'
import type { FileSystemService } from './file-system.service'
import { MCP_TOOL_GROUPS } from './conversation/thread-mcp'
import { projectToolModes } from './conversation/tool-groups'
import { ThreadPermissionStore } from './conversation/thread-permissions'
import { readRepoConfigState } from './repo-config/loader'
import { MainRefusal } from './main-refusal'
import { McpConfigSync } from './mcp-sync.service'
import { OXE_YAML_FILE } from './repo-config/parser'
import { withToolMode } from './repo-config/tool-modes-writer'

const cost = (chars: number): McpToolCost => ({ chars, tokens: estimateTokens(chars) })

/** Settings › Tools (F10): each group, its mode in the project and what it costs, measured like the CI budget (T8). */
export async function toolGroupsReport(rootPath: string | null): Promise<McpToolGroupsReport> {
  const [{ TOOL_REGISTRY }, { toolDefinitionChars, toolNameChars }] = await Promise.all([import('../mcp-internal/tool-registry'), import('../mcp-internal/tool-cost')])
  // A broken oxe.yaml is reported as such: the defaults apply meanwhile, and the page says the file needs fixing.
  const config = rootPath ? await readRepoConfigState(rootPath) : { state: 'missing' as const, config: null }
  const modes = projectToolModes(config.config?.thread)
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
  return { rootPath, oxeYaml: config.state, groups, totals: { plainConversation: cost(core + offered(false)), everythingOnDemand: cost(core + offered(true)) } }
}

/** The workspace id the file service accepts for a registered project root: a Code workspace or an OXESpace conversation project. */
export function registeredProject(db: AppDatabase, rootPath: string): string | null {
  const workspace = db.prepare('SELECT id FROM workspaces WHERE root_path = ?').get(rootPath) as { id: string } | undefined
  if (workspace) return workspace.id
  const project = db.prepare('SELECT project_id FROM thread_project_contexts WHERE root_path = ?').get(rootPath) as { project_id: string } | undefined
  return project ? `thread:${project.project_id}` : null
}

/** The registered project's workspace id, or a coded refusal: tool groups are read and set only for a project OXESpace knows. */
export function requireRegisteredProject(db: AppDatabase, rootPath: string): string {
  const workspaceId = registeredProject(db, rootPath)
  if (!workspaceId) throw new MainRefusal('mcp.toolGroups.unknownProject', {})
  return workspaceId
}

/**
 * Writes one group's mode to the project's oxe.yaml through the file service (inside the registered root only, replaced
 * atomically and only if nobody changed it since it was read), records it in the project's audit, and rewrites the
 * `.mcp.json` of the Code workspaces on that root so a group turned off is gone there too. The person's choice, from
 * the app's window only.
 */
export async function setToolGroupMode(db: AppDatabase, files: FileSystemService, input: { rootPath: string; group: ConfigurableMcpToolGroup; mode: McpToolGroupMode }): Promise<McpToolGroupsReport> {
  const workspaceId = requireRegisteredProject(db, input.rootPath)
  const target = { workspaceId, rootPath: input.rootPath, relativePath: OXE_YAML_FILE }
  const existing = await files.readFile(target).catch((error: NodeJS.ErrnoException) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  const content = withToolMode(existing?.content ?? null, input.group, input.mode)
  await files.replaceFile({ ...target, content, expectedMtimeMs: existing?.mtimeMs ?? null })
  new ThreadPermissionStore(db).audit({ projectRoot: input.rootPath, action: 'configuration', actor: 'user', summary: `Set the ${input.group} tool group to ${input.mode}` })
  // Best effort: oxe.yaml is already saved, and the next sync of the workspace writes the same thing.
  try {
    const sync = new McpConfigSync(db)
    for (const row of db.prepare('SELECT id FROM workspaces WHERE root_path = ?').all(input.rootPath) as { id: string }[]) sync.syncWorkspace(row.id)
  } catch { /* the file stays as it was until the next sync */ }
  return toolGroupsReport(input.rootPath)
}
