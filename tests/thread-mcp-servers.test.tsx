import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ThreadMcpServerStatus } from '../shared/types/thread'
import { McpPanel } from '../src/components/MCP/McpPanel'

const servers: ThreadMcpServerStatus[] = [
  { name: 'mongodb', status: 'failed' },
  { name: 'playwright', status: 'connected' },
  { name: 'azure-devops', status: 'connected' },
  { name: 'claude.ai Gmail', status: 'connected' },
  { name: 'claude.ai Figma', status: 'needs-auth' },
  { name: 'claude.ai Canva', status: 'needs-auth' }
]

describe('Thread MCP servers', () => {
  it('lists the servers of the open conversation in Connections', () => {
    window.oxe = { ...window.oxe, mcp: { ...(window.oxe?.mcp ?? {}), list: vi.fn(async () => []) }, mcpInternal: { getStatus: vi.fn(async () => null) } } as unknown as typeof window.oxe
    render(<McpPanel workspaceId={null} conversationServers={servers} onClose={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /This conversation/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: 'Connected: 3' })).toBeVisible()
    // The composer's MCP chip is gone (T57); this list is where a failed or signed-out server shows.
    expect(screen.getByRole('region', { name: 'Needs sign-in: 2' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Failed to start: 1' })).toHaveTextContent('mongodb')
  })
})
