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

export type McpHealthStatus = 'unknown' | 'starting' | 'healthy' | 'unhealthy'

export interface McpServer {
  id: string
  /** Null = global (cross-workspace). */
  workspaceId: string | null
  name: string
  transport: McpTransport
  config: McpServerConfig
  enabled: boolean
  trusted: boolean
  health: McpHealthStatus
  healthMessage: string | null
  /** Tools cached after the most recent successful handshake. */
  tools: McpToolDescriptor[]
  createdAtMs: number
  updatedAtMs: number
}

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
  serverId: string
  status: McpHealthStatus
  message: string | null
}
