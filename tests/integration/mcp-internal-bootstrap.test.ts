import { describe, expect, test, vi } from 'vitest'

// The internal MCP server is built from a list of dependencies; a dependency that is
// accepted by `createInternalMcpHandle` but never handed on to the RPC server makes every
// tool that needs it fail at run time ("OxeQuery is unavailable"). This pins the hand-over.
const captured: { deps?: Record<string, unknown> } = {}

vi.mock('electron', () => ({
  app: { getPath: () => 'C:/tmp/oxe-test', getAppPath: () => 'C:/tmp/oxe-test', isPackaged: false }
}))
vi.mock('electron-log/main.js', () => ({ default: { info: () => undefined, warn: () => undefined, error: () => undefined } }))
vi.mock('../../electron/main/mcp-internal/local-rpc-server', () => ({
  createLocalRpcServer: (deps: Record<string, unknown>) => {
    captured.deps = deps
    return { start: async () => ({ port: 0 }), stop: async () => undefined, setToken: () => undefined, getStatus: () => ({ running: false, port: null, uptimeMs: 0 }) }
  }
}))

describe('createInternalMcpHandle', () => {
  test('hands the OxeQuery gateway to the RPC server', async () => {
    const { createInternalMcpHandle } = await import('../../electron/main/mcp-internal/bootstrap')
    const gateway = { marker: 'gateway' }
    const oxeQuery = () => gateway as never
    createInternalMcpHandle({
      db: {} as never, threads: {} as never, delegation: {} as never, executions: {} as never, team: {} as never,
      delegationAgents: () => [], memory: {} as never, oxeQuery, mcpManager: {} as never
    } as never)
    expect(captured.deps?.oxeQuery).toBe(oxeQuery)
  })
})
