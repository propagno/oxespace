import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { McpPanel } from '../../src/components/MCP/McpPanel'
import { useMcpStore } from '../../src/store/mcp.store'

/**
 * End-to-end-ish test for the MCP "JSON" entry mode. Uses the same IPC stub
 * pattern as McpTemplatePicker.test — we don't talk to the real main process,
 * but we assert that the JSON input ends up as a faithful CreateMcpServerInput
 * delivered to window.oxe.mcp.create.
 *
 * The headline scenario is the GitHub MCP server, which is the user's
 * explicit acceptance criterion ("garantir 100% testando com o MCP do
 * github"). The three JSON shapes we accept are covered separately by
 * parseMcpJson.test.ts; here we focus on the UI wiring.
 */

const GITHUB_JSON_FULL = JSON.stringify({
  mcpServers: {
    github: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test_token_abc' }
    }
  }
}, null, 2)

const GITHUB_JSON_ANON = JSON.stringify({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test_token_abc' }
}, null, 2)

function stubMcpApi(createImpl: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined)): ReturnType<typeof vi.fn> {
  window.oxe = {
    ...(window.oxe ?? {}),
    mcp: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      create: createImpl,
      update: vi.fn(),
      delete: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      callTool: vi.fn(),
      setTrust: vi.fn(),
      onHealth: vi.fn(() => () => undefined)
    }
  } as unknown as typeof window.oxe
  useMcpStore.setState({ servers: [], loading: false, error: null, healthByServer: {} })
  return createImpl
}

async function openJsonMode(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /Add MCP server/i }))
  await user.click(screen.getByTestId('mcp-create-mode-json'))
}

describe('McpPanel — JSON entry mode (GitHub MCP)', () => {
  beforeEach(() => {
    stubMcpApi()
  })

  test('pastes full mcpServers JSON for GitHub and creates the server', async () => {
    const user = userEvent.setup()
    const createSpy = stubMcpApi()

    render(<McpPanel workspaceId={null} onClose={vi.fn()} />)
    await openJsonMode(user)

    const textarea = screen.getByTestId('mcp-create-json-textarea') as HTMLTextAreaElement
    // userEvent.type is slow on long strings; paste-style via fireEvent change.
    await user.clear(textarea)
    await user.click(textarea)
    // Use clipboard paste because typing the JSON would interpret braces as keys.
    await user.paste(GITHUB_JSON_FULL)

    await user.click(screen.getByRole('button', { name: /Add from JSON/i }))

    expect(createSpy).toHaveBeenCalledTimes(1)
    const payload = createSpy.mock.calls[0][0] as {
      name: string
      transport: string
      config: { command: string; args: string[]; env: Record<string, string> }
      trusted: boolean
      enabled: boolean
    }
    expect(payload.name).toBe('github')
    expect(payload.transport).toBe('stdio')
    expect(payload.config.command).toBe('npx')
    expect(payload.config.args).toEqual(['-y', '@modelcontextprotocol/server-github'])
    expect(payload.config.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test_token_abc' })
    // Always created untrusted — the server still needs an explicit "Trust"
    // before the McpManager will spawn it.
    expect(payload.trusted).toBe(false)
    expect(payload.enabled).toBe(true)
  })

  test('anonymous JSON shape requires the user to supply a name', async () => {
    const user = userEvent.setup()
    const createSpy = stubMcpApi()

    render(<McpPanel workspaceId={null} onClose={vi.fn()} />)
    await openJsonMode(user)

    const textarea = screen.getByTestId('mcp-create-json-textarea') as HTMLTextAreaElement
    await user.click(textarea)
    await user.paste(GITHUB_JSON_ANON)
    await user.click(screen.getByRole('button', { name: /Add from JSON/i }))

    // No name was provided either in JSON or in the "Name" input — should
    // surface the error inline and NOT call create.
    expect(createSpy).not.toHaveBeenCalled()
    expect(await screen.findByText(/was not in the JSON/i)).toBeInTheDocument()

    // Now type a name and try again.
    await user.type(screen.getByLabelText(/Name \(only if JSON omits it\)/i), 'github')
    await user.click(screen.getByRole('button', { name: /Add from JSON/i }))

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect((createSpy.mock.calls[0][0] as { name: string }).name).toBe('github')
  })

  test('invalid JSON shows a parser error and does not create anything', async () => {
    const user = userEvent.setup()
    const createSpy = stubMcpApi()

    render(<McpPanel workspaceId={null} onClose={vi.fn()} />)
    await openJsonMode(user)

    const textarea = screen.getByTestId('mcp-create-json-textarea') as HTMLTextAreaElement
    await user.click(textarea)
    await user.paste('{ this is not json')
    await user.click(screen.getByRole('button', { name: /Add from JSON/i }))

    expect(createSpy).not.toHaveBeenCalled()
    expect(await screen.findByText(/Invalid JSON/i)).toBeInTheDocument()
  })

  test('multi-server JSON creates one entry per server in a single click', async () => {
    const user = userEvent.setup()
    const createSpy = stubMcpApi()

    render(<McpPanel workspaceId={null} onClose={vi.fn()} />)
    await openJsonMode(user)

    const multi = JSON.stringify({
      mcpServers: {
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github']
        },
        playwright: {
          command: 'npx',
          args: ['-y', '@playwright/mcp@latest']
        }
      }
    })
    const textarea = screen.getByTestId('mcp-create-json-textarea') as HTMLTextAreaElement
    await user.click(textarea)
    await user.paste(multi)
    await user.click(screen.getByRole('button', { name: /Add from JSON/i }))

    expect(createSpy).toHaveBeenCalledTimes(2)
    expect((createSpy.mock.calls[0][0] as { name: string }).name).toBe('github')
    expect((createSpy.mock.calls[1][0] as { name: string }).name).toBe('playwright')
  })
})
