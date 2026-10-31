/** C3 message codes of the mcp domain (`mcp.*`); merged into `MessageParams` and `MESSAGE_CODES` by shared/messages.ts. */

export interface McpMessageParams {
  /** MCP quarantine: tools whose description or inputs changed after the person trusted the server. */
  'mcp.quarantine.changed': { tools: string[] }
  /** MCP quarantine: tools the server added after it was trusted. */
  'mcp.quarantine.added': { tools: string[] }
  /** MCP quarantine: tools the server removed after it was trusted. */
  'mcp.quarantine.removed': { tools: string[] }
  /** MCP quarantine: the server's command, arguments, environment or URL no longer match what was trusted. */
  'mcp.quarantine.configChanged': Record<string, never>
  'mcp.signIn.waiting': Record<string, never>
  'mcp.server.quarantined': Record<string, never>
  'mcp.server.untrusted': Record<string, never>
  /** Settings › Tools (F10): the folder is neither a Code workspace nor an OxeChat project, so its tool groups are not OXESpace's to read or change. */
  'mcp.toolGroups.unknownProject': Record<string, never>
  /** Settings › Tools: the project's oxe.yaml is not valid YAML; it is left as it is until fixed by hand. */
  'mcp.toolGroups.invalidYaml': Record<string, never>
  /** Settings › Tools: oxe.yaml is valid YAML but not a mapping of settings. */
  'mcp.toolGroups.notMapping': Record<string, never>
  /** Settings › Tools: `thread` in oxe.yaml is written inline (`thread: { … }`), which this editor does not rewrite. */
  'mcp.toolGroups.inlineThread': Record<string, never>
  /** Settings › Tools: the edit would have changed more than `thread.tools` (anchors, aliases, an unusual layout), so nothing was written. */
  'mcp.toolGroups.unsafeEdit': Record<string, never>
}

export const MCP_MESSAGE_CODES = [
  'mcp.quarantine.changed',
  'mcp.quarantine.added',
  'mcp.quarantine.removed',
  'mcp.quarantine.configChanged',
  'mcp.signIn.waiting',
  'mcp.server.quarantined',
  'mcp.server.untrusted',
  'mcp.toolGroups.unknownProject',
  'mcp.toolGroups.invalidYaml',
  'mcp.toolGroups.notMapping',
  'mcp.toolGroups.inlineThread',
  'mcp.toolGroups.unsafeEdit'
] as const satisfies readonly (keyof McpMessageParams)[]
