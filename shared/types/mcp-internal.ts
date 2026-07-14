/**
 * Types for the internal OXESpace MCP server.
 *
 * The server lives in three places that talk over the same envelope:
 *   1. The bridge process (resources/mcp-bridge/oxespace-mcp.js) spawned by
 *      agent CLIs — speaks MCP stdio outward, HTTP JSON-RPC inward.
 *   2. The local RPC HTTP server (electron/main/mcp-internal/local-rpc-server.ts)
 *      embedded in OXESpace main — receives the JSON-RPC envelope, dispatches.
 *   3. The renderer-facing IPC (electron/main/ipc/mcp-internal.ipc.ts) — exposes
 *      status + token regeneration + web-preview event subscription.
 */

export interface InternalMcpJsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string | null
  method: string
  params?: unknown
}

export interface InternalMcpJsonRpcSuccess<T = unknown> {
  jsonrpc: '2.0'
  id: number | string | null
  result: T
}

export interface InternalMcpJsonRpcError {
  jsonrpc: '2.0'
  id: number | string | null
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export type InternalMcpJsonRpcResponse<T = unknown> =
  | InternalMcpJsonRpcSuccess<T>
  | InternalMcpJsonRpcError

/**
 * Standard JSON-RPC error codes plus a few OXESpace-specific ones reserved
 * in the -32000..-32099 range (the spec's "server error" zone).
 */
export const INTERNAL_MCP_ERROR_CODES = {
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Custom (server error range)
  TOOL_NOT_FOUND: -32001,
  WORKSPACE_REQUIRED: -32002,
  AUTH_REQUIRED: -32003
} as const

/** Tool descriptor exchanged over `tools/list`. Mirrors the MCP spec shape. */
export interface InternalMcpToolDescriptor {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
  }
}

/** Content block returned in a `tools/call` result (MCP spec content array). */
export type InternalMcpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

export interface InternalMcpToolCallResult {
  content: InternalMcpContentBlock[]
  isError?: boolean
}

/** Renderer-facing status of the internal server. */
export interface InternalMcpStatus {
  running: boolean
  port: number | null
  bridgePath: string | null
  serverRowId: string | null
  lastError: string | null
  uptimeMs: number
  toolCount: number
  /** Static tool catalogue — name + 1-line description for the MCP panel. */
  tools: Array<{ name: string; description: string }>
}

/** Payload broadcast to renderer windows when a tool opens a web preview. */
export interface InternalMcpWebPreviewEvent {
  workspaceId: string
  url: string
  requestedAt: number
}

/**
 * Payload broadcast to renderer windows when a tool mutates the git worktree
 * set (create/remove). The renderer's worktree store re-fetches `rootPath` so
 * the Worktree panel + sidebar badge reflect the agent's action without a
 * manual refresh.
 */
export interface InternalMcpWorktreeChangedEvent {
  workspaceId: string
  rootPath: string
  action: 'created' | 'removed'
  requestedAt: number
}

/* ── Tool I/O shapes (kept in sync with tool-registry.ts schemas) ── */

export interface WorkspaceListItem {
  id: string
  name: string
  rootPath: string
  isActive: boolean
}

export interface PaneListItem {
  id: string
  type: string
  rowIndex: number
  columnIndex: number
  agentName: string | null
  status: string
  rootPath: string | null
  displayName: string | null
}

export interface ScriptListItem {
  id: string
  name: string
  relativePath: string
  extension: 'ps1' | 'sh' | 'npm'
  command: string
}

export interface RunScriptArgs {
  scriptId: string
  paneRootPath?: string | null
}

export interface RunScriptResult {
  jobId: string
  status: string
}

export interface ListBackgroundJobsArgs {
  status?: 'running' | 'pending' | 'exited' | 'failed' | 'killed'
}

export interface StopBackgroundJobArgs {
  jobId: string
}

export interface GetJobOutputArgs {
  jobId: string
}

export interface CreateWorktreeArgs {
  path: string
  branch: string
  createBranch?: boolean
}

export interface RemoveWorktreeArgs {
  path: string
  force?: boolean
}

export interface OpenWebPreviewArgs {
  url: string
}
