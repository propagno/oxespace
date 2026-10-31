/**
 * Settings › Tools (F10): the groups of OXESpace MCP tools a conversation is offered, how each is offered in a project,
 * and what each costs. The same groups apply to Thread conversations and to agents in Code terminals (B2.2), and the
 * cost is computed by the same code the CI budget test uses (T8).
 */
import type { MessageCode } from '../messages'

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
 * `always`: offered from the start, definitions included. `on-demand`: with tool search (Claude with
 * `ENABLE_TOOL_SEARCH=true`) only the names are sent until Claude loads a definition; Codex loads MCP definitions as it
 * needs them, so it is offered every group that is not off from the start; Claude without tool search turns the group on
 * with `oxespace_tools_enable`. `off`: never offered, in OxeChat, in Code terminals or through the workspace's
 * `.mcp.json`, and a session cannot turn it on.
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
  /** Codex loads definitions as it needs them: a group costs its definitions once Codex loads them. */
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
  /**
   * The project's `oxe.yaml`: `missing` (the app's defaults apply), `valid`, or `invalid` (it cannot be read as
   * settings; the defaults apply until it is fixed by hand, and `setToolGroupMode` refuses with
   * `mcp.toolGroups.invalidYaml`). Always `missing` when `rootPath` is `null`.
   */
  oxeYaml: 'missing' | 'valid' | 'invalid'
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
   * app's window only, and records it in the audit. The person's choice: never an MCP tool. Reading and writing both
   * need a project OXESpace knows. A refusal rejects with an error whose message is one of
   * `MCP_TOOL_GROUPS_REFUSAL_CODES` (a C3 code the window turns into words); any other message is an invalid request.
   */
  setToolGroupMode?(input: { rootPath: string; group: ConfigurableMcpToolGroup; mode: McpToolGroupMode }): Promise<McpToolGroupsReport>
}

/** Why `toolGroups` or `setToolGroupMode` refused: the error's message, a message code of `shared/messages.ts`. */
export const MCP_TOOL_GROUPS_REFUSAL_CODES = ['mcp.toolGroups.unknownProject', 'mcp.toolGroups.invalidYaml', 'mcp.toolGroups.notMapping',
  'mcp.toolGroups.inlineThread', 'mcp.toolGroups.unsafeEdit', 'project.file.changedMeanwhile'] as const satisfies readonly MessageCode[]
export type McpToolGroupsRefusalCode = typeof MCP_TOOL_GROUPS_REFUSAL_CODES[number]

export const isMcpToolGroupsRefusal = (message: unknown): message is McpToolGroupsRefusalCode =>
  (MCP_TOOL_GROUPS_REFUSAL_CODES as readonly unknown[]).includes(message)

/**
 * Characters per token of OXESpace tool definitions, measured in a real Claude session on 2026-10-30 (T8, see
 * docs/validation/tool-groups-cost-1.4.md: 47,411 characters of definitions were 19,875 tokens). The one place to
 * recalibrate when the tokenizer changes.
 */
export const CHARS_PER_TOKEN = 2.4

export const estimateTokens = (chars: number): number => Math.ceil(chars / CHARS_PER_TOKEN)
