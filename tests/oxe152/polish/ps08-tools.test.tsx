// Acceptance test for 1.5.2 Polimento · Configurações (Jira OXE-241, PS-08·14, CA-1 to CA-3).
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ToolsSettings } from '../../../src/components/Settings/ToolsSettings'
import { DevicesSettings } from '../../../src/components/Settings/DevicesSettings'
import { McpCatalog } from '../../../src/components/MCP/McpCatalog'
import { useUIStore } from '../../../src/store/ui.store'
import { useRemoteStore } from '../../../src/store/remote.store'
import type { McpServer } from '../../../shared/types/mcp'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

afterEach(() => {
  cleanup()
  useUIStore.setState({ isMcpPanelOpen: false })
  vi.restoreAllMocks()
})

describe('OXE-241 · PS-08·14 Tools and Devices h3 headings, Manage MCP button and McpCatalog tokens', () => {
  test('Tools and Devices headings go h2 then h3, never h4', () => {
    const toolsRender = render(<ToolsSettings rootPath="" />)
    expect(toolsRender.container.querySelectorAll('h2').length).toBeGreaterThan(0)
    expect(toolsRender.container.querySelectorAll('h3').length).toBeGreaterThan(0)
    expect(toolsRender.container.querySelectorAll('h4')).toHaveLength(0)
    cleanup()

    Object.assign(window, {
      oxe: {
        ...(window as unknown as { oxe?: object }).oxe,
        remote: {
          status: vi.fn(async () => ({
            enabled: false,
            listening: null,
            desktopName: 'OXESpace',
            maxDevices: 3,
            phoneWritePanes: []
          })),
          listDevices: vi.fn(async () => []),
          onChanged: vi.fn(() => () => undefined),
          onPairingFailed: vi.fn(() => () => undefined)
        }
      }
    })
    useRemoteStore.setState({
      status: {
        enabled: false,
        listening: null,
        desktopName: 'OXESpace',
        maxDevices: 3,
        phoneWritePanes: []
      },
      devices: [],
      loadError: ''
    })

    const devicesRender = render(<DevicesSettings />)
    expect(devicesRender.container.querySelectorAll('h2').length).toBeGreaterThan(0)
    expect(devicesRender.container.querySelectorAll('h3').length).toBeGreaterThan(0)
    expect(devicesRender.container.querySelectorAll('h4')).toHaveLength(0)
  })

  test('MCP servers and skills has a secondary sm Manage MCP servers… Button that opens the McpCatalog', () => {
    useUIStore.setState({ isMcpPanelOpen: false })
    render(<ToolsSettings rootPath="" />)

    const btn = screen.getByRole('button', { name: /Manage MCP servers/i })
    expect(btn.getAttribute('data-ui')).toBe('button')
    expect(btn.getAttribute('data-variant')).toBe('secondary')
    expect(btn.getAttribute('data-size')).toBe('sm')

    fireEvent.click(btn)
    expect(useUIStore.getState().isMcpPanelOpen).toBe(true)
  })

  test('[css] McpCatalog tabs use var(--control-md) and its state dots are StatusSignal, no --dot-*', () => {
    const css = read('src/components/MCP/McpCatalog.css')
    expect(css).toMatch(/\.mcp-view-tabs\s+button\s*\{[^}]*height:\s*var\(--control-md\)/)
    expect(css).not.toMatch(/--dot-/)

    const server = {
      id: 'srv-github',
      name: 'GitHub',
      scope: 'global',
      enabled: true,
      health: 'healthy',
      config: { transport: 'http', url: 'https://api.githubcopilot.com/mcp/' }
    } as unknown as McpServer

    const { container } = render(
      <McpCatalog
        servers={[server]}
        query="github"
        busyId={null}
        onAdd={vi.fn()}
        onTest={vi.fn()}
      />
    )

    const signal = container.querySelector('.mcp-catalog-state [data-ui="status-signal"]')
    expect(signal).not.toBeNull()
    expect(signal?.getAttribute('data-state')).toBe('done')
  })
})
