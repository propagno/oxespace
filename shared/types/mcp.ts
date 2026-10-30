export type McpTransport = 'stdio' | 'http' | 'sse'

export interface McpStdioConfig {
  transport: 'stdio'
  /** Executable to spawn (e.g. `npx`, `node`, full path). */
  command: string
  /** Args passed to the executable. */
  args: string[]
  /** Env vars to set when spawning. */
  env: Record<string, string>
}

export interface McpHttpConfig {
  transport: 'http' | 'sse'
  url: string
  headers: Record<string, string>
}

export type McpServerConfig = McpStdioConfig | McpHttpConfig

/**
 * What OXESpace remembers since the person trusted a server (see electron/main/services/mcp-guard.ts).
 * A server whose tools or descriptions changed afterwards is quarantined: untrusted until the person
 * trusts it again. Secrets never appear here, only what to tell the person.
 */
export interface McpServerGuard {
  /** The tools and descriptions seen since trust are remembered, so a later change can be told. */
  toolsRemembered: boolean
  quarantine: { at: number; reasons: string[]; added: string[]; removed: string[]; changed: string[] } | null
}

/**
 * What OXESpace saw the last time it tested the server. `needs-auth`: the server
 * answered and wants a sign-in, which the agent does on first use.
 */
export type McpHealthStatus = 'unknown' | 'starting' | 'healthy' | 'needs-auth' | 'unhealthy'

export interface McpServer {
  /** `healthMessage` as a message code the window translates (C3). */
  healthMessageCode?: import('../messages').MainMessage
  id: string
  /** Null = global (cross-workspace). */
  workspaceId: string | null
  name: string
  transport: McpTransport
  config: McpServerConfig
  enabled: boolean
  trusted: boolean
  /** Absent for servers that never were trusted. */
  guard?: McpServerGuard
  health: McpHealthStatus
  healthMessage: string | null
  /** Tools cached after the most recent successful handshake. */
  tools: McpToolDescriptor[]
  /** When OXESpace last tested the server in this run of the app; null when it has not. */
  testedAtMs?: number | null
  createdAtMs: number
  updatedAtMs: number
}

/** A test run to explain a failure: the tested server and the Node.js a Node-based server runs on. */
export interface McpDiagnosis { server: McpServer; node: string | null }

export interface McpToolDescriptor {
  name: string
  description: string
  /** JSON Schema describing tool inputs (Anthropic-style). */
  inputSchema: unknown
}

export interface CreateMcpServerInput {
  workspaceId: string | null
  name: string
  transport: McpTransport
  config: McpServerConfig
  enabled?: boolean
  trusted?: boolean
}

export interface UpdateMcpServerInput {
  id: string
  name?: string
  transport?: McpTransport
  config?: McpServerConfig
  enabled?: boolean
  trusted?: boolean
}

export interface McpCallToolInput {
  serverId: string
  toolName: string
  arguments: Record<string, unknown>
}

export interface McpCallToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string } | { type: 'resource'; uri: string; mimeType?: string }>
  isError?: boolean
}

export interface McpServerHealthEvent {
  /** The sentence above as a message code the window translates (C3); the text stays for logs and older clients. */
  messageCode?: import('../messages').MainMessage
  serverId: string
  status: McpHealthStatus
  message: string | null
}

/** A server another tool already has, as offered for import. Secret values are never included, only their names. */
export interface McpDiscoveredServer {
  name: string
  transport: McpTransport
  /** The command line, or the URL. */
  target: string
  secretNames: string[]
  /** A server with this name is already saved in the chosen scope. */
  exists: boolean
}
/** What an import did, server by server: one that cannot be added does not stop the others. */
export interface McpImportResult {
  created: McpServer[]
  failed: Array<{ name: string; reason: string }>
}
export interface McpDiscoverySource {
  id: 'claude-desktop' | 'cursor' | 'windsurf'
  label: string
  servers: McpDiscoveredServer[]
}
