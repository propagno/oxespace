// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { McpToolPickerPopover } from '../../src/components/MCP/McpToolPickerPopover'
import { useMcpStore } from '../../src/store/mcp.store'
import { useMcpPickerStore } from '../../src/store/mcp-picker.store'
import type { McpResourceAttachment, McpServer } from '../../shared/types/mcp'
import '../../src/i18n'

function makeServer(overrides: Partial<McpServer> & { id: string; name: string }): McpServer {
  return {
    workspaceId: 'ws-1',
    key: overrides.name.toLowerCase(),
    transport: 'http',
    config: { transport: 'http', url: `https://${overrides.name.toLowerCase()}.example.com/mcp`, headers: {} },
    enabled: true,
    trusted: true,
    guard: { toolsRemembered: true, quarantine: null },
    health: 'healthy',
    healthMessage: null,
    tools: [],
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides
  }
}

describe('OXE-482 · McpToolPickerPopover (Tool Picker, Pinning/Quarantine & MCP Resources)', () => {
  const listResourcesMock = vi.fn()
  const readResourceMock = vi.fn()

  beforeEach(() => {
    listResourcesMock.mockReset()
    readResourceMock.mockReset()

    const github = makeServer({
      id: 'srv-github',
      name: 'GitHub',
      key: 'github',
      transport: 'http',
      tools: [
        { name: 'list_issues', description: 'List repository issues', inputSchema: {} },
        { name: 'create_pr', description: 'Open a pull request', inputSchema: {} }
      ]
    })
    const compromised = makeServer({
      id: 'srv-evil',
      name: 'Compromised',
      key: 'compromised',
      transport: 'stdio',
      trusted: false,
      config: { transport: 'stdio', command: 'node', args: ['srv.js'], env: {} },
      guard: {
        toolsRemembered: true,
        quarantine: {
          at: Date.now(),
          reasons: ['The description of "read" changed after you trusted it.'],
          added: [],
          removed: [],
          changed: ['read']
        }
      },
      tools: [{ name: 'read', description: 'Changed tool', inputSchema: {} }]
    })

    useMcpStore.setState({
      serversByWorkspace: { 'ws-1': [github, compromised] },
      loading: false,
      error: null
    })
    useMcpPickerStore.setState({
      disabledToolsByThread: {},
      resourcesByServer: {},
      mcpResourcesByThread: {}
    })

    ;(window as unknown as { oxe: unknown }).oxe = {
      mcp: {
        list: vi.fn().mockResolvedValue([github, compromised]),
        listResources: listResourcesMock.mockResolvedValue([
          { uri: 'repo://README.md', name: 'README.md', mimeType: 'text/markdown' }
        ]),
        readResource: readResourceMock.mockResolvedValue({
          contents: [{ uri: 'repo://README.md', mimeType: 'text/markdown', text: '# Project Docs' }]
        })
      }
    }
  })

  it('shows N/M enabled counters, preserves quarantine badge & lock, and toggles per-server and per-tool state', () => {
    render(
      <McpToolPickerPopover
        workspaceId="ws-1"
        threadId="thread-1"
        open
        initialTab="tools"
        onOpenChange={() => undefined}
        trigger={<span />}
      />
    )

    // Total counter: 2 enabled on GitHub, 0/1 on Quarantined -> 2/3 enabled
    expect(screen.getByTestId('mcp-picker-total-counter').textContent).toBe('2/3 enabled')
    expect(screen.getByTestId('mcp-picker-count-github').textContent).toBe('2/2 enabled')
    expect(screen.getByTestId('mcp-picker-count-compromised').textContent).toBe('0/1 enabled')

    // Quarantine trust badge and locked warning are preserved
    expect(screen.getByTestId('mcp-picker-trust-github').getAttribute('data-trust')).toBe('trusted')
    expect(screen.getByTestId('mcp-picker-trust-compromised').getAttribute('data-trust')).toBe('quarantined')
    expect(screen.getByTestId('mcp-picker-quarantine-warning-compromised')).toBeTruthy()

    // Expand GitHub tools and disable one tool (`create_pr`)
    fireEvent.click(screen.getByLabelText(/Expand GitHub tools/i))
    const createPrCheckbox = screen.getByLabelText('create_pr') as HTMLInputElement
    expect(createPrCheckbox.checked).toBe(true)
    fireEvent.click(createPrCheckbox)

    expect(screen.getByTestId('mcp-picker-count-github').textContent).toBe('1/2 enabled')
    expect(useMcpPickerStore.getState().disabledToolsByThread['thread-1']).toEqual(['github/create_pr'])

    // Toggle whole GitHub server off via its switch
    const githubSwitch = screen.getByRole('switch', { name: /Toggle GitHub tools/i })
    fireEvent.click(githubSwitch)
    expect(screen.getByTestId('mcp-picker-count-github').textContent).toBe('0/2 enabled')
    expect(useMcpPickerStore.getState().disabledToolsByThread['thread-1']).toEqual(['github/*'])

    // Search filters tools cleanly
    const search = screen.getByLabelText(/Filter MCP tools and resources/i)
    fireEvent.change(search, { target: { value: 'list_issues' } })
    expect(screen.getByTestId('mcp-picker-server-github')).toBeTruthy()
    expect(screen.queryByTestId('mcp-picker-server-compromised')).toBeNull()
  })

  it('lists and attaches MCP Resources from trusted servers into conversation context', async () => {
    const attached: McpResourceAttachment[] = []
    render(
      <McpToolPickerPopover
        workspaceId="ws-1"
        threadId="thread-1"
        open
        initialTab="resources"
        onOpenChange={() => undefined}
        onAttachResource={item => attached.push(item)}
        trigger={<span />}
      />
    )

    await waitFor(() => {
      expect(listResourcesMock).toHaveBeenCalledWith('srv-github')
    })
    // Quarantined server must NEVER have resources fetched
    expect(listResourcesMock).not.toHaveBeenCalledWith('srv-evil')

    const attachBtn = await screen.findByTestId('mcp-attach-resource-README.md')
    fireEvent.click(attachBtn)

    await waitFor(() => {
      expect(readResourceMock).toHaveBeenCalledWith({ serverId: 'srv-github', uri: 'repo://README.md' })
      expect(attached).toHaveLength(1)
    })
    expect(attached[0]).toMatchObject({
      serverId: 'srv-github',
      serverName: 'GitHub',
      uri: 'repo://README.md',
      name: 'README.md',
      text: '# Project Docs'
    })
  })
})
