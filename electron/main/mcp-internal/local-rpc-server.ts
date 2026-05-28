import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type {
  InternalMcpJsonRpcRequest,
  InternalMcpJsonRpcResponse
} from '../../../shared/types/mcp-internal'
import { INTERNAL_MCP_ERROR_CODES } from '../../../shared/types/mcp-internal'
import { TOOL_REGISTRY, findTool, type ToolContext } from './tool-registry'
import { errorResult } from './tool-registry'

/**
 * Localhost JSON-RPC server that backs the OXESpace MCP bridge.
 *
 * The bridge process (resources/mcp-bridge/oxespace-mcp.js) is spawned by
 * an agent CLI in each pane. The bridge forwards `tools/list` / `tools/call`
 * here. We validate the bearer token + workspace id, dispatch through the
 * tool registry, and return a JSON-RPC envelope.
 *
 * Hardened defaults:
 *   - Bound to 127.0.0.1 ONLY (no LAN exposure)
 *   - Bearer token with constant-time compare
 *   - X-OXE-Workspace-Id required for workspace-scoped tools
 *   - JSON-RPC errors stay in the -32000..-32099 server-error range
 *   - Request body capped at 64 KB to keep a renegade bridge from OOM'ing main
 */

const MAX_BODY_BYTES = 64 * 1024
const STARTED_AT = Date.now()

export interface LocalRpcDeps extends Omit<ToolContext, 'workspaceId'> {}

export interface LocalRpcServer {
  start(port: number): Promise<{ port: number }>
  stop(): Promise<void>
  setToken(token: string): void
  getStatus(): { running: boolean; port: number | null; uptimeMs: number }
}

export function createLocalRpcServer(deps: LocalRpcDeps): LocalRpcServer {
  let token: string | null = null
  let server: http.Server | null = null
  let actualPort: number | null = null

  const respond = (
    res: http.ServerResponse,
    status: number,
    body: InternalMcpJsonRpcResponse | { ok: true; uptimeMs: number; version: string }
  ): void => {
    const payload = JSON.stringify(body)
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload).toString(),
      'Cache-Control': 'no-store'
    })
    res.end(payload)
  }

  const respondText = (res: http.ServerResponse, status: number, message: string): void => {
    const payload = JSON.stringify({ ok: false, message })
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload).toString()
    })
    res.end(payload)
  }

  const validateAuth = (req: http.IncomingMessage): boolean => {
    if (!token) return false
    const header = req.headers.authorization
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
    const provided = header.slice('Bearer '.length)
    const a = Buffer.from(provided)
    const b = Buffer.from(token)
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  }

  const readBody = (req: http.IncomingMessage): Promise<string> => {
    return new Promise((resolve, reject) => {
      let total = 0
      let chunks = ''
      req.setEncoding('utf8')
      req.on('data', (chunk: string) => {
        total += Buffer.byteLength(chunk)
        if (total > MAX_BODY_BYTES) {
          reject(new Error('Request body exceeds limit'))
          req.destroy()
          return
        }
        chunks += chunk
      })
      req.on('end', () => resolve(chunks))
      req.on('error', reject)
    })
  }

  const dispatchRpc = async (
    parsed: InternalMcpJsonRpcRequest,
    workspaceId: string | null
  ): Promise<InternalMcpJsonRpcResponse> => {
    const id = parsed.id ?? null

    if (parsed.method === 'ping') {
      return { jsonrpc: '2.0', id, result: { ok: true } }
    }

    if (parsed.method === 'tools/list') {
      const tools = TOOL_REGISTRY.map((entry) => entry.descriptor)
      return { jsonrpc: '2.0', id, result: { tools } }
    }

    if (parsed.method === 'tools/call') {
      const params = (parsed.params ?? {}) as { name?: string; arguments?: unknown }
      const name = params.name
      if (typeof name !== 'string' || !name) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: INTERNAL_MCP_ERROR_CODES.INVALID_PARAMS, message: 'tools/call: missing tool name' }
        }
      }
      const tool = findTool(name)
      if (!tool) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: INTERNAL_MCP_ERROR_CODES.TOOL_NOT_FOUND, message: `Unknown tool: ${name}` }
        }
      }
      if (tool.requiresWorkspace && !workspaceId) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: INTERNAL_MCP_ERROR_CODES.WORKSPACE_REQUIRED,
            message: `Tool ${name} requires X-OXE-Workspace-Id header`
          }
        }
      }
      try {
        const ctx: ToolContext = { ...deps, workspaceId }
        const result = await tool.handler(params.arguments, ctx)
        return { jsonrpc: '2.0', id, result }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught)
        const errBlock = errorResult(message)
        // Surface the failure as an MCP "isError" content payload — agents
        // render this inline rather than treating it as transport failure.
        return { jsonrpc: '2.0', id, result: errBlock }
      }
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: INTERNAL_MCP_ERROR_CODES.METHOD_NOT_FOUND, message: `Method not found: ${parsed.method}` }
    }
  }

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    // /healthz is auth'd too — no public probes.
    if (req.method === 'GET' && req.url === '/healthz') {
      if (!validateAuth(req)) {
        respondText(res, 401, 'unauthorized')
        return
      }
      respond(res, 200, { ok: true, uptimeMs: Date.now() - STARTED_AT, version: '0.1.0' })
      return
    }

    if (req.method !== 'POST' || req.url !== '/rpc') {
      respondText(res, 404, 'not found')
      return
    }

    if (!validateAuth(req)) {
      respondText(res, 401, 'unauthorized')
      return
    }

    let body: string
    try {
      body = await readBody(req)
    } catch (caught) {
      respondText(res, 413, caught instanceof Error ? caught.message : 'body read failed')
      return
    }

    let parsed: InternalMcpJsonRpcRequest
    try {
      parsed = JSON.parse(body) as InternalMcpJsonRpcRequest
    } catch {
      respond(res, 400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: INTERNAL_MCP_ERROR_CODES.INVALID_REQUEST, message: 'Invalid JSON' }
      })
      return
    }
    if (!parsed || parsed.jsonrpc !== '2.0' || typeof parsed.method !== 'string') {
      respond(res, 400, {
        jsonrpc: '2.0',
        id: parsed?.id ?? null,
        error: { code: INTERNAL_MCP_ERROR_CODES.INVALID_REQUEST, message: 'Malformed JSON-RPC envelope' }
      })
      return
    }

    const workspaceHeader = req.headers['x-oxe-workspace-id']
    const workspaceId = typeof workspaceHeader === 'string' && workspaceHeader.trim() ? workspaceHeader.trim() : null

    const envelope = await dispatchRpc(parsed, workspaceId)
    respond(res, 200, envelope)
  }

  return {
    async start(port: number): Promise<{ port: number }> {
      if (server) throw new Error('LocalRpcServer already started')
      return new Promise<{ port: number }>((resolve, reject) => {
        const s = http.createServer((req, res) => {
          void handle(req, res).catch((err) => {
            try { respondText(res, 500, err instanceof Error ? err.message : 'internal error') } catch { /* socket closed */ }
          })
        })
        s.once('error', (err) => reject(err))
        s.listen(port, '127.0.0.1', () => {
          const address = s.address()
          if (typeof address === 'object' && address && 'port' in address) {
            actualPort = address.port
            server = s
            resolve({ port: actualPort })
          } else {
            reject(new Error('Failed to read bound port'))
          }
        })
      })
    },
    async stop(): Promise<void> {
      if (!server) return
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => (err ? reject(err) : resolve()))
      })
      server = null
      actualPort = null
    },
    setToken(next: string): void {
      token = next
    },
    getStatus() {
      return {
        running: server !== null,
        port: actualPort,
        uptimeMs: Date.now() - STARTED_AT
      }
    }
  }
}
