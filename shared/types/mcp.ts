import type { MainMessage } from '../messages'

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
 * The config a person last trusted, without a secret (shared/mcp-trusted.ts): environment and header KEYS only,
 * secret-looking argument values replaced by `[redacted]`, and the URL as origin and path (no user info, query or
 * fragment). What a moved config is compared with.
 */
export type McpTrustedSnapshot =
  | { transport: 'stdio'; command: string; args: string[]; envKeys: string[] }
  | { transport: 'http' | 'sse'; url: string; headerKeys: string[] }

/**
 * What OXESpace remembers since the person trusted a server (see electron/main/services/mcp-guard.ts).
 * A server whose tools or descriptions changed afterwards is quarantined: untrusted until the person
 * trusts it again. Secrets never appear here, only what to tell the person.
 */
export interface McpServerGuard {
  /** The tools and descriptions seen since trust are remembered, so a later change can be told. */
  toolsRemembered: boolean
  /**
   * `reasons` are English sentences, kept for records written before `codes` existed and for anything that reads
   * them. `codes` say the same as message codes the window translates (shared/messages.ts); absent on older records.
   */
  quarantine: {
    at: number; reasons: string[]; codes?: MainMessage[]; added: string[]; removed: string[]; changed: string[]
    /** The config as last trusted, to show next to the server's current one; absent on records written before it existed. */
    trusted?: McpTrustedSnapshot
  } | null
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
  /**
   * The server's key in a conversation and in `.mcp.json`, and the `server` of its tool rules (B7.3), so the window can
   * group rules under its servers: `serverKey(name)`, with `-2`, `-3`… when two servers of the scope (the global ones
   * with the workspace's) normalize alike, in creation order. Main fills it on every server it returns.
   */
  key?: string
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
  /** True when an OAuth token for this remote server is stored in the OS keychain. Never carries the token itself. */
  oauthConnected?: boolean
  /** When OXESpace last tested the server in this run of the app; null when it has not. */
  testedAtMs?: number | null
  createdAtMs: number
  updatedAtMs: number
}

/**
 * The key a configured server gets from its name: in a conversation, in `.mcp.json`, in policy resources
 * (`mcp__<key>__<tool>`) and in tool rules. One function for main and the window.
 */
export const serverKey = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp-server'

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

/** An MCP resource advertised by a server via `resources/list`. */
export interface McpResourceDescriptor {
  uri: string
  name: string
  description?: string
  mimeType?: string
  size?: number
}

/** One content block returned by `resources/read`, already bounded and secret-redacted in main. */
export interface McpResourceContent {
  uri: string
  mimeType?: string
  text?: string
  /** Set when the server returned binary data (base64 blob bytes) instead of text. */
  blobBytes?: number
  truncated?: boolean
}

export interface McpReadResourceInput {
  serverId: string
  uri: string
}

export interface McpReadResourceResult {
  contents: McpResourceContent[]
}

/** An MCP resource attached to a conversation draft in OxeChat (bounded & secret-redacted). */
export interface McpResourceAttachment {
  id: string
  serverId: string
  serverName: string
  uri: string
  name: string
  mimeType?: string
  text: string
  bytes: number
  truncated?: boolean
}

/** Combines attached MCP resources with the user's message text at send time. */
export function composeMessageWithMcpResources(draft: string, resources: readonly McpResourceAttachment[]): string {
  if (resources.length === 0) return draft
  const blocks = resources.map(item => {
    const header = `MCP Resource [${item.serverName}] ${item.name} (${item.uri}${item.mimeType ? `, ${item.mimeType}` : ''})${item.truncated ? ' [truncated]' : ''}:`
    return `${header}\n\`\`\`\n${item.text}\n\`\`\``
  })
  const trimmed = draft.trim()
  if (trimmed) blocks.push(trimmed)
  return blocks.join('\n\n')
}

/** Keychain-backed OAuth connection status for a remote MCP server. Never contains tokens or secrets. */
export interface McpOAuthStatus {
  serverId: string
  connected: boolean
  expiresAtMs?: number | null
  hasRefreshToken?: boolean
  scope?: string | null
  authorizationServer?: string | null
  keychainAvailable: boolean
}

export interface McpOAuthConnectResult {
  ok: boolean
  status: McpOAuthStatus
  error?: string
}

export interface McpApi {
  list(workspaceId: string | null): Promise<McpServer[]>
  create(input: CreateMcpServerInput): Promise<McpServer>
  update(input: UpdateMcpServerInput): Promise<McpServer>
  delete(id: string): Promise<void>
  start(id: string): Promise<McpToolDescriptor[]>
  stop(id: string): Promise<void>
  /** Handshake and tool list, then the server is let go; the outcome is on the returned server. */
  test(id: string): Promise<McpServer>
  /** A test plus the Node.js version the server would run on, to explain why it failed. */
  diagnose?(id: string): Promise<McpDiagnosis>
  /** Reopens the browser sign-in page of a server that is waiting to authenticate. */
  openSignIn(id: string): Promise<boolean>
  callTool(input: McpCallToolInput): Promise<McpCallToolResult>
  /** Lists resources exposed by a trusted MCP server (`resources/list`). */
  listResources?(serverId: string): Promise<McpResourceDescriptor[]>
  /** Reads a bounded, secret-redacted resource from a trusted MCP server (`resources/read`). */
  readResource?(input: McpReadResourceInput): Promise<McpReadResourceResult>
  /** Runs native OAuth 2.1 + PKCE sign-in and stores tokens encrypted in the OS keychain. */
  connectOAuth?(serverId: string): Promise<McpOAuthConnectResult>
  /** Removes stored OAuth tokens for this server from the OS keychain. */
  disconnectOAuth?(serverId: string): Promise<McpOAuthStatus>
  /** Reads keychain OAuth connection status for this server (never returns tokens). */
  oauthStatus?(serverId: string): Promise<McpOAuthStatus>
  /** Servers Claude Desktop, Cursor and Windsurf already have, without their secret values. */
  discover?(workspaceId: string | null): Promise<McpDiscoverySource[]>
  /** Creates the named servers of one source, untrusted, in the global or workspace scope. */
  importDiscovered?(input: { workspaceId: string | null; source: McpDiscoverySource['id']; names: string[] }): Promise<McpImportResult>
  onHealth(listener: (event: McpServerHealthEvent) => void): () => void
}
