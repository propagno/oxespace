import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ConversationThread, ThreadMcpServerStatus } from '../shared/types/thread'
import { ThreadMcpHealth } from '../src/components/Threads/ThreadMcpHealth'
import { McpPanel } from '../src/components/MCP/McpPanel'

const servers: ThreadMcpServerStatus[] = [
  { name: 'mongodb', status: 'failed' },
  { name: 'playwright', status: 'connected' },
  { name: 'azure-devops', status: 'connected' },
  { name: 'claude.ai Gmail', status: 'connected' },
  { name: 'claude.ai Figma', status: 'needs-auth' },
  { name: 'claude.ai Canva', status: 'needs-auth' }
]
const thread = { mcpServers: { servers, checkedAt: 1 } } as unknown as ConversationThread

describe('Thread MCP servers', () => {
  it('counts only configured servers that failed as a problem, not claude.ai connectors waiting for sign-in', () => {
    render(<ThreadMcpHealth thread={thread} />)
    expect(screen.getByRole('button', { name: '1 MCP server unavailable, 3 connected' })).toHaveTextContent('MCP · 1 failed')
  })

  it('shows connected servers when nothing failed', () => {
    render(<ThreadMcpHealth thread={{ mcpServers: { servers: servers.filter(server => server.status !== 'failed'), checkedAt: 1 } } as unknown as ConversationThread} />)
    expect(screen.getByRole('button', { name: '3 MCP servers connected' })).toHaveTextContent('MCP · 3')
  })

  it('says the servers are stopped, not failed, while the conversation is closed for being idle', () => {
    render(<ThreadMcpHealth thread={{ ...thread, connection: { state: 'closed', attempt: 0, changedAt: 1, suspendedAt: 1 } } as ConversationThread} />)
    const chip = screen.getByRole('button', { name: /stopped while the conversation is idle/ })
    expect(chip).toHaveTextContent('MCP · stopped')
    expect(chip).not.toHaveClass('is-warning')
  })

  it('groups the servers by state in the popover', async () => {
    const user = userEvent.setup()
    render(<ThreadMcpHealth thread={thread} />)
    await user.click(screen.getByRole('button', { name: /MCP server/ }))
    expect(within(screen.getByRole('region', { name: 'Connected: 3' })).getAllByRole('listitem').map(item => item.textContent)).toEqual(['azure-devops', 'claude.aiGmail', 'playwright'])
    expect(screen.getByRole('region', { name: 'Needs sign-in: 2' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Failed to start: 1' })).toHaveTextContent('mongodb')
  })

  it('lists the servers of the open conversation in Connections', () => {
    window.oxe = { ...window.oxe, mcp: { ...(window.oxe?.mcp ?? {}), list: vi.fn(async () => []) }, mcpInternal: { getStatus: vi.fn(async () => null) } } as unknown as typeof window.oxe
    render(<McpPanel workspaceId={null} conversationServers={servers} onClose={vi.fn()} />)
    expect(screen.getByRole('tab', { name: /This conversation/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: 'Connected: 3' })).toBeVisible()
  })
})
