/**
 * Settings › Tools (F10): the groups of OXESpace MCP tools a conversation is offered, how each is offered in a project,
 * and what each costs. The same groups apply to Thread conversations and to agents in Code terminals (B2.2), and the
 * cost is computed by the same code the CI budget test uses (T8).
 */

/** The groups, as the Thread runtime knows them. `team` and `worker` follow the conversation's role. */
export const MCP_TOOL_GROUP_IDS = ['core', 'orchestration', 'data', 'docs', 'app', 'team', 'worker'] as const
export type McpToolGroupId = typeof MCP_TOOL_GROUP_IDS[number]

/** Groups a project can switch between modes. `core` is always on; `team` and `worker` follow the role. */
export const CONFIGURABLE_MCP_TOOL_GROUPS = ['orchestration', 'data', 'docs', 'app'] as const satisfies readonly McpToolGroupId[]
export type ConfigurableMcpToolGroup = typeof CONFIGURABLE_MCP_TOOL_GROUPS[number]

/**
 * `always`: the definitions go with every request. `on-demand`: only the names do; Claude loads a definition when it
 * searches for it, and on Codex a session turns the group on with `oxespace_tools_enable`. `off`: not offered, and a
 * session cannot turn it on.
 */
export const MCP_TOOL_GROUP_MODES = ['always', 'on-demand', 'off'] as const
export type McpToolGroupMode = typeof MCP_TOOL_GROUP_MODES[number]

/** Estimated size of what a provider receives. Tokens are characters / 4, an estimate; T8 records the real ratio. */
export interface McpToolCost {
  chars: number
  tokens: number
}

export interface McpToolGroupCost {
  claude: {
    /** Every definition of the group, sent with each request. */
    loaded: McpToolCost
    /** The fixed cost on demand: the tool names only. */
    deferred: McpToolCost
  }
  /** Codex has no tool search: a group costs its definitions once it is on. */
  codex: { loaded: McpToolCost }
}

export interface McpToolGroupInfo {
  id: McpToolGroupId
  tools: string[]
  mode: McpToolGroupMode
  /** Where the mode comes from: the app's default, the project's `oxe.yaml`, or the conversation's role. */
  source: 'default' | 'project' | 'role'
  configurable: boolean
  cost: McpToolGroupCost
}

export interface McpToolGroupsReport {
  /** The project the modes are read from; `null` for the app's defaults. */
  rootPath: string | null
  groups: McpToolGroupInfo[]
  totals: {
    /** What a conversation that asks for nothing extra sends (Claude). */
    plainConversation: McpToolCost
    /** Every configurable group on demand, the fixed cost included (Claude). */
    everythingOnDemand: McpToolCost
  }
}

export interface McpToolGroupsApi {
  toolGroups?(input?: { rootPath?: string }): Promise<McpToolGroupsReport>
  /**
   * Writes the group's mode to the project's `oxe.yaml` (`thread.tools`), inside the registered workspace only, from the
   * app's window only, and records it in the audit. The person's choice: never an MCP tool.
   */
  setToolGroupMode?(input: { rootPath: string; group: ConfigurableMcpToolGroup; mode: McpToolGroupMode }): Promise<McpToolGroupsReport>
}

export const estimateTokens = (chars: number): number => Math.ceil(chars / 4)
