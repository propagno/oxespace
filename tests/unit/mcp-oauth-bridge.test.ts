import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))

describe('OAuth bridge detection', () => {
  it('recognises mcp-remote however it is invoked', async () => {
    const { usesOAuthBridge } = await import('../../electron/main/services/mcp.service')
    const config = (args: string[]) => ({ transport: 'stdio' as const, command: 'npx', args, env: {} })
    expect(usesOAuthBridge(config(['-y', 'mcp-remote', 'https://mcp.notion.com/mcp']))).toBe(true)
    expect(usesOAuthBridge(config(['-y', 'mcp-remote@latest', 'https://mcp.linear.app/sse']))).toBe(true)
    expect(usesOAuthBridge(config(['/opt/tools/node_modules/mcp-remote', 'https://x']))).toBe(true)
    expect(usesOAuthBridge(config(['-y', '@modelcontextprotocol/server-github']))).toBe(false)
    expect(usesOAuthBridge(config(['-y', 'my-mcp-remote-clone']))).toBe(false)
  })
})

describe('sign-in URL detection', () => {
  it('picks the authorization URL line and ignores the rest of the bridge output', async () => {
    const { extractSignInUrl } = await import('../../electron/main/services/mcp.service')
    const url = 'https://mcp.notion.com/authorize?response_type=code&client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A9553%2Foauth%2Fcallback'
    expect(extractSignInUrl(url)).toBe(url)
    expect(extractSignInUrl('Please authorize this client by visiting:')).toBeNull()
    expect(extractSignInUrl('[111648] Connecting to remote server: https://mcp.notion.com/mcp')).toBeNull()
    expect(extractSignInUrl('https://example.com/docs')).toBeNull()
    expect(extractSignInUrl('http://insecure.example/authorize')).toBeNull()
  })
})
