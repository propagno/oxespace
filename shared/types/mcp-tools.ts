/**
 * Settings › Tools (F10): the groups of OXESpace MCP tools a conversation is offered, how each is offered in a project,
 * and what each costs. The same groups apply to Thread conversations and to agents in Code terminals (B2.2), and the
 * cost is computed by the same code the CI budget test uses (T8).
 */

/**
 * The groups. `team` and `worker` follow the conversation's role; `code` is the Code terminal's own, always on there and
 * never offered to an OxeChat conversation.
 */
export const MCP_TOOL_GROUP_IDS = ['core', 'orchestration', 'data', 'docs', 'app', 'team', 'worker', 'code'] as const
export type McpToolGroupId = typeof MCP_TOOL_GROUP_IDS[number]

/** Groups a project can switch between modes. `core` is always on; `team`, `worker` and `code` follow the role. */
export const CONFIGURABLE_MCP_TOOL_GROUPS = ['orchestration', 'data', 'docs', 'app'] as const satisfies readonly McpToolGroupId[]
export type ConfigurableMcpToolGroup = typeof CONFIGURABLE_MCP_TOOL_GROUPS[number]

/**
 * `always`: the definitions go with every request. `on-demand`: only the names do; Claude loads a definition when it
 * searches for it, and on Codex a session turns the group on with `oxespace_tools_enable`. `off`: not offered, and a
 * session cannot turn it on.
 */
export const MCP_TOOL_GROUP_MODES = ['always', 'on-demand', 'off'] as const
export type McpToolGroupMode = typeof MCP_TOOL_GROUP_MODES[number]

/** Estimated size of what a provider receives. Tokens are an estimate from characters (`CHARS_PER_TOKEN`); the page labels them so. */
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
  /** B7.3: what each MCP tool of a project needs before it runs (OXESpace's and other servers'). */
  toolRules?(input: { rootPath: string }): Promise<McpToolRule[]>
  /**
   * Sets one tool's rule in the project, from the app's window only, and records it in the audit. The person's choice:
   * never an MCP tool. Refused, with a code, for `allow` on an OXESpace tool of the confirm level.
   */
  setToolRule?(input: { rootPath: string; server: string; tool: string; decision: McpToolDecision }): Promise<McpToolRule[]>
}

/** Per tool: run without asking, ask the person (the default), or never run. */
export const MCP_TOOL_DECISIONS = ['allow', 'ask', 'deny'] as const
export type McpToolDecision = typeof MCP_TOOL_DECISIONS[number]

/**
 * One tool's rule, and where it holds. `deny` is a `tool.use` rule in the project's `.oxespace/policy.json`: it holds
 * everywhere (OxeChat conversations, OxeCode terminals and MCP). `allow` is a project permission rule: it holds for
 * OxeChat conversations, while agents in OxeCode terminals follow their own CLI's permissions. `ask` is no rule.
 */
export interface McpToolRule {
  /** The MCP server's key, `oxespace-delegation` for OXESpace's own tools. */
  server: string
  tool: string
  decision: McpToolDecision
  /** Where the deciding rule lives; `default` when there is none. A user or managed rule cannot be changed here. */
  source: 'project' | 'user' | 'managed' | 'default'
  editable: boolean
  scope: 'everywhere' | 'oxechat' | null
}

/**
 * Characters per token of OXESpace tool definitions, measured in a real Claude session on 2026-10-30 (T8, see
 * docs/validation/tool-groups-cost-1.4.md: 47,411 characters of definitions were 19,875 tokens). The one place to
 * recalibrate when the tokenizer changes.
 */
export const CHARS_PER_TOKEN = 2.4

export const estimateTokens = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN)
