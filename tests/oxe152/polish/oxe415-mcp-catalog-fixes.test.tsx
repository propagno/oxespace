// Unit tests for OXE-415: MCP Catalog Asana v2, npx cold-start timeout, templates, edit/toggle UI & select clipping.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDatabase } from '../../../electron/main/db/index'
import { RETIRED_MCP_ENDPOINTS, upgradeRetiredMcpEndpoints } from '../../../electron/main/services/mcp-retired-endpoints'
import { initTimeoutMsFor, isPackageRunnerCommand, PACKAGE_RUNNER_INIT_TIMEOUT_MS } from '../../../electron/main/services/mcp.service'
import { catalogConfig, MCP_CATALOG } from '../../../src/components/MCP/connectorCatalog'
import { MCP_TEMPLATES, McpPanel } from '../../../src/components/MCP/McpPanel'
import { useMcpStore } from '../../../src/store/mcp.store'
import type { McpServer, UpdateMcpServerInput } from '../../../shared/types/mcp'

const makeServer = (overrides: Partial<McpServer> = {}): McpServer => ({
  id: 'srv-1',
  workspaceId: 'ws-1',
  name: 'filesystem',
  transport: 'stdio',
  config: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'], env: { FOO: 'bar' } },
  enabled: true,
  trusted: true,
  health: 'unknown',
  healthMessage: null,
  tools: [],
  createdAtMs: 1,
  updatedAtMs: 1,
  ...overrides
})

describe('OXE-415 · MCP Catalog Asana v2, npx cold-start timeout, templates, edit/toggle UI & select clipping', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('uses Asana v2 Streamable HTTP endpoint in catalog and migrates retired /sse endpoint', () => {
    const asana = MCP_CATALOG.find(entry => entry.id === 'asana')!
    expect(asana).toBeDefined()
    expect(catalogConfig(asana)).toEqual({ transport: 'http', url: 'https://mcp.asana.com/v2/mcp', headers: {} })
    expect(RETIRED_MCP_ENDPOINTS['https://mcp.asana.com/sse']).toBe('https://mcp.asana.com/v2/mcp')

    const stdioUpdates: Array<{ config: unknown; at: number; id: string }> = []
    const remoteUpdates: Array<{ transport: string; config: unknown; at: number; id: string }> = []
    const stdioRows = [
      { id: 'asana-bridge', config_json: JSON.stringify({ transport: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.asana.com/sse'] }) }
    ]
    const remoteRows = [
      { id: 'asana-sse', config_json: JSON.stringify({ transport: 'sse', url: 'https://mcp.asana.com/sse', headers: {} }) }
    ]
    const db = {
      prepare: (sql: string) => {
        if (sql.includes("WHERE transport = 'stdio'")) return { all: () => stdioRows }
        if (sql.includes("WHERE transport IN ('sse', 'http')")) return { all: () => remoteRows }
        if (sql.includes('SET transport = ?')) {
          return { run: (transport: string, json: string, at: number, id: string) => remoteUpdates.push({ transport, config: JSON.parse(json), at, id }) }
        }
        return { run: (json: string, at: number, id: string) => stdioUpdates.push({ config: JSON.parse(json), at, id }) }
      }
    } as unknown as AppDatabase

    expect(upgradeRetiredMcpEndpoints(db, 100)).toBe(2)
    expect(stdioUpdates).toEqual([
      { id: 'asana-bridge', at: 100, config: { transport: 'stdio', command: 'npx', args: ['-y', 'mcp-remote', 'https://mcp.asana.com/v2/mcp'] } }
    ])
    expect(remoteUpdates).toEqual([
      { id: 'asana-sse', at: 100, transport: 'http', config: { transport: 'http', url: 'https://mcp.asana.com/v2/mcp', headers: {} } }
    ])
  })

  it('gives package runners (npx/uvx/etc.) a 60s cold-start init timeout', () => {
    expect(PACKAGE_RUNNER_INIT_TIMEOUT_MS).toBe(60_000)
    for (const cmd of ['npx', 'npx.cmd', 'C:\\Program Files\\nodejs\\npx.cmd', 'uvx', 'uvx.exe', 'bunx', 'pnpm', 'yarn', 'npm']) {
      expect(isPackageRunnerCommand(cmd), cmd).toBe(true)
      expect(initTimeoutMsFor({ transport: 'stdio', command: cmd, args: ['-y', 'pkg'], env: {} }), cmd).toBe(60_000)
    }
    expect(isPackageRunnerCommand('node')).toBe(false)
    expect(initTimeoutMsFor({ transport: 'stdio', command: 'node', args: ['server.js'], env: {} })).toBe(15_000)
  })

  it('contains zero broken or deprecated packages in MCP_TEMPLATES', () => {
    const serialized = JSON.stringify(MCP_TEMPLATES)
    expect(serialized).not.toContain('@modelcontextprotocol/server-fetch')
    expect(serialized).not.toContain('@modelcontextprotocol/server-github')
    expect(serialized).not.toContain('@modelcontextprotocol/server-postgres')

    const fetchTpl = MCP_TEMPLATES.find(t => t.id === 'fetch')
    expect(fetchTpl?.fill).toMatchObject({ command: 'uvx', argsText: 'mcp-server-fetch' })

    const pgTpl = MCP_TEMPLATES.find(t => t.id === 'postgres')
    expect(pgTpl?.fill?.argsText).toContain('@microsoft/postgres-mcp')
  })

  it('prevents vertical text clipping on <Select> inside .mcp-create-form', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/mcp.css'), 'utf8')
    const selectRule = /\.mcp-create-form\s+select\s*\{([^}]+)\}/.exec(css)
    expect(selectRule).not.toBeNull()
    expect(selectRule![1]).toContain('height: var(--control-md)')
    expect(selectRule![1]).toContain('padding: 0 var(--space-6) 0 var(--space-2)')
  })

  describe('McpPanel UI interactions', () => {
    const updateMock = vi.fn<(input: UpdateMcpServerInput) => Promise<McpServer>>()
    const listMock = vi.fn<(workspaceId: string | null) => Promise<McpServer[]>>()

    beforeEach(() => {
      updateMock.mockReset()
      listMock.mockReset()
      const srv = makeServer()
      listMock.mockResolvedValue([srv])
      updateMock.mockImplementation(async (input) => ({
        ...srv,
        name: input.name ?? srv.name,
        enabled: input.enabled ?? srv.enabled,
        config: input.config ?? srv.config
      }))
      ;(window as unknown as { oxe: unknown }).oxe = {
        mcp: {
          list: listMock,
          update: updateMock,
          create: vi.fn(),
          delete: vi.fn(),
          test: vi.fn(),
          stop: vi.fn()
        }
      }
      useMcpStore.setState({ serversByWorkspace: { 'ws-1': [srv] }, loading: false, error: null })
    })

    it('exposes Enable/Disable switch and Edit button on McpServerRow calling updateServer', async () => {
      render(<McpPanel workspaceId="ws-1" onClose={vi.fn()} />)

      // Switch to Installed tab
      const installedTab = screen.getByRole('tab', { name: /installed/i })
      fireEvent.click(installedTab)

      // Toggle enabled switch
      const toggle = await screen.findByRole('switch', { name: /disable filesystem/i })
      expect(toggle).toHaveAttribute('aria-checked', 'true')
      fireEvent.click(toggle)
      await waitFor(() => {
        expect(updateMock).toHaveBeenCalledWith({ id: 'srv-1', enabled: false })
      })

      // Click Edit button -> form opens pre-populated and saves via updateServer
      const editBtn = screen.getByRole('button', { name: /edit filesystem/i })
      fireEvent.click(editBtn)

      expect(screen.queryByLabelText(/template/i)).not.toBeInTheDocument()
      const nameInput = screen.getByDisplayValue('filesystem')
      fireEvent.change(nameInput, { target: { value: 'fs-renamed' } })

      const saveBtn = screen.getByRole('button', { name: /save changes/i })
      fireEvent.click(saveBtn)

      await waitFor(() => {
        expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
          id: 'srv-1',
          name: 'fs-renamed',
          transport: 'stdio'
        }))
      })
    })

    it('hides Template dropdown and Form|JSON mode toggle when configuring a remote catalog connector', async () => {
      render(<McpPanel workspaceId="ws-1" onClose={vi.fn()} />)

      // GitHub in catalog is a remote connector requiring GITHUB_PERSONAL_ACCESS_TOKEN
      const addGithub = await screen.findByRole('button', { name: /github/i })
      fireEvent.click(addGithub)

      expect(await screen.findByDisplayValue('https://api.githubcopilot.com/mcp/')).toBeInTheDocument()
      expect(screen.queryByLabelText(/template/i)).not.toBeInTheDocument()
      expect(screen.queryByTestId('mcp-create-mode-json')).not.toBeInTheDocument()
    })
  })
})
