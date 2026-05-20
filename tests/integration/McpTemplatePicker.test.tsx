import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { McpPanel } from '../../src/components/MCP/McpPanel'
import { useMcpStore } from '../../src/store/mcp.store'

describe('McpPanel — template picker (Onda 6)', () => {
  beforeEach(() => {
    // Stub the IPC bridge that McpPanel reaches through useMcpStore.
    window.oxe = {
      ...(window.oxe ?? {}),
      mcp: {
        list: vi.fn().mockResolvedValue([]),
        get: vi.fn(),
        create: vi.fn().mockResolvedValue(undefined),
        update: vi.fn(),
        delete: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        callTool: vi.fn(),
        setTrust: vi.fn(),
        onHealth: vi.fn(() => () => undefined)
      }
    } as unknown as typeof window.oxe
    // Reset store state between tests.
    useMcpStore.setState({ servers: [], loading: false, error: null, healthByServer: {} })
  })

  test('Playwright template fills the form with the official npx command', async () => {
    const user = userEvent.setup()
    render(<McpPanel workspaceId={null} onClose={vi.fn()} />)

    // Open the create form.
    await user.click(screen.getByRole('button', { name: /Adicionar MCP server/i }))

    // Switch template to Playwright.
    const templateSelect = screen.getByLabelText('Template') as HTMLSelectElement
    await user.selectOptions(templateSelect, 'playwright')

    // Form fields should now reflect the official command.
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('playwright')
    expect((screen.getByLabelText('Comando') as HTMLInputElement).value).toBe('npx')
    expect((screen.getByLabelText(/Args/) as HTMLInputElement).value).toBe('-y @playwright/mcp@latest')
  })

  test('Filesystem template fills with the server-filesystem package', async () => {
    const user = userEvent.setup()
    render(<McpPanel workspaceId={null} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Adicionar MCP server/i }))
    await user.selectOptions(screen.getByLabelText('Template') as HTMLSelectElement, 'filesystem')
    expect((screen.getByLabelText(/Args/) as HTMLInputElement).value).toContain('@modelcontextprotocol/server-filesystem')
  })

  test('Custom template leaves fields empty', async () => {
    const user = userEvent.setup()
    render(<McpPanel workspaceId={null} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Adicionar MCP server/i }))

    // Pick a non-empty template first, then switch back to custom — the fields
    // for "custom" should NOT auto-clear (template just doesn't fill them).
    // We assert the initial empty state to confirm "custom" is the default.
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Comando') as HTMLInputElement).value).toBe('')
  })

  test('Saving a Playwright template forwards args[] to mcp.create', async () => {
    const user = userEvent.setup()
    const createSpy = vi.fn().mockResolvedValue(undefined)
    ;(window.oxe.mcp.create as ReturnType<typeof vi.fn>) = createSpy

    render(<McpPanel workspaceId={null} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /Adicionar MCP server/i }))
    await user.selectOptions(screen.getByLabelText('Template') as HTMLSelectElement, 'playwright')
    await user.click(screen.getByRole('button', { name: /Adicionar server/i }))

    expect(createSpy).toHaveBeenCalledTimes(1)
    const payload = createSpy.mock.calls[0][0] as {
      name: string
      transport: string
      config: { command: string; args: string[] }
    }
    expect(payload.name).toBe('playwright')
    expect(payload.transport).toBe('stdio')
    expect(payload.config.command).toBe('npx')
    expect(payload.config.args).toEqual(['-y', '@playwright/mcp@latest'])
  })
})
