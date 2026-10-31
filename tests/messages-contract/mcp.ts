import type { McpMessageParams } from '../../shared/messages/mcp'

/** The parameter names each mcp code carries, as the catalogs must interpolate them (C3 contract, S0.1 part 2b). */
export const MCP_PARAMETERS: Record<keyof McpMessageParams, string[]> = {
  'mcp.quarantine.changed': ['tools'],
  'mcp.quarantine.added': ['tools'],
  'mcp.quarantine.removed': ['tools'],
  'mcp.quarantine.configChanged': [],
  'mcp.signIn.waiting': [],
  'mcp.server.quarantined': [],
  'mcp.server.untrusted': [],
  'mcp.toolGroups.unknownProject': [],
  'mcp.toolGroups.invalidYaml': [],
  'mcp.toolGroups.notMapping': [],
  'mcp.toolGroups.inlineThread': [],
  'mcp.toolGroups.unsafeEdit': []
}
