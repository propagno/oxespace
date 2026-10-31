import { describe, expect, it } from 'vitest'
import { installMcpFixture, mcpFixtureMode, type FixtureIpc } from '../../electron/main/e2e/mcp-fixture'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { McpServer } from '../../shared/types/mcp'

type Listener = (event: unknown, ...args: unknown[]) => unknown

function fakeIpc(): FixtureIpc & { handlers: Map<string, Listener>; invoke(channel: string, ...args: unknown[]): unknown } {
  const handlers = new Map<string, Listener>()
  return {
    handlers,
    handle(channel, listener) { handlers.set(channel, listener) },
    invoke(channel, ...args) { return handlers.get(channel)!({}, ...args) }
  }
}

const ASKED = { OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_E2E_MCP_FIXTURE: 'quarantine' }

describe('E2E MCP fixture gate', () => {
  it('never loads in a packaged build, whatever the environment says', () => {
    const ipc = fakeIpc()
    expect(mcpFixtureMode(ASKED, true)).toBeNull()
    expect(installMcpFixture(ipc, ASKED, true)).toBeNull()
    expect(ipc.handlers.size).toBe(0)
  })

  it('loads in an unpackaged E2E run that asks for it', () => {
    const ipc = fakeIpc()
    expect(installMcpFixture(ipc, ASKED, false)).toBe('quarantine')
    const servers = ipc.invoke(IPC_CHANNELS.mcp.list) as McpServer[]
    expect(servers.map(server => server.name)).toEqual(['docs-search', 'deploy-helper', 'new-server', 'notes'])
    expect(servers.find(server => server.name === 'deploy-helper')?.guard?.quarantine?.codes).toEqual([{ code: 'mcp.quarantine.configChanged', params: {} }])
  })

  it('needs both the E2E mocks and the fixture name', () => {
    expect(mcpFixtureMode({ OXESPACE_E2E_MCP_FIXTURE: 'quarantine' }, false)).toBeNull()
    expect(mcpFixtureMode({ OXESPACE_E2E_MOCK_NATIVE: '1' }, false)).toBeNull()
    expect(mcpFixtureMode({ OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_E2E_MCP_FIXTURE: 'other' }, false)).toBeNull()
  })
})

describe('E2E MCP fixture behaviour', () => {
  it('refuses to start or test an untrusted server and runs nothing', () => {
    const ipc = fakeIpc()
    installMcpFixture(ipc, ASKED, false)
    expect(() => ipc.invoke(IPC_CHANNELS.mcp.start, 'fixture-docs-search')).toThrow(/Quarantined/)
    expect(ipc.invoke(IPC_CHANNELS.mcp.test, 'fixture-deploy-helper')).toMatchObject({ health: 'unhealthy', healthMessageCode: { code: 'mcp.server.quarantined' } })
    expect(ipc.invoke(IPC_CHANNELS.mcp.test, 'fixture-new-server')).toMatchObject({ health: 'unhealthy', healthMessageCode: { code: 'mcp.server.untrusted' } })
    expect(() => ipc.invoke(IPC_CHANNELS.mcp.callTool, { serverId: 'fixture-notes', toolName: 'list_notes' })).toThrow()
  })

  it('clears the quarantine in memory when the person trusts the server again', () => {
    const ipc = fakeIpc()
    installMcpFixture(ipc, ASKED, false)
    expect(ipc.invoke(IPC_CHANNELS.mcp.update, { id: 'fixture-docs-search', trusted: true })).toMatchObject({ trusted: true, guard: { quarantine: null } })
    expect(ipc.invoke(IPC_CHANNELS.mcp.test, 'fixture-docs-search')).toMatchObject({ health: 'healthy' })
    // A second install starts from the fixture again.
    const fresh = fakeIpc()
    installMcpFixture(fresh, ASKED, false)
    expect((fresh.invoke(IPC_CHANNELS.mcp.list) as McpServer[])[0].trusted).toBe(false)
  })
})
