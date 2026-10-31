import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpImportPanel } from '../src/components/MCP/McpImportPanel'
import type { McpDiscoverySource } from '../shared/types/mcp'

afterEach(() => { cleanup(); delete (window as { oxe?: unknown }).oxe })

const sources: McpDiscoverySource[] = [{ id: 'cursor', label: 'Cursor', servers: [
  { name: 'github', transport: 'stdio', target: 'npx -y server-github', secretNames: ['GITHUB_TOKEN'], exists: false },
  { name: 'docs', transport: 'http', target: 'https://mcp.example.com/mcp', secretNames: [], exists: true }
] }]

describe('McpImportPanel', () => {
  it('lists servers by name only, disables the ones already added and imports the chosen ones', async () => {
    const importDiscovered = vi.fn(async () => ({ created: [], failed: [] }))
    ;(window as unknown as { oxe: unknown }).oxe = { mcp: { discover: async () => sources, importDiscovered } }
    const onImported = vi.fn()
    render(<McpImportPanel workspaceId="ws" onImported={onImported} onClose={() => {}} />)
    await screen.findByText('github')
    expect(screen.getByText(/Copies GITHUB_TOKEN/)).toBeVisible()
    expect(screen.getByRole('checkbox', { name: 'docs' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'github' }))
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 server' }))
    await waitFor(() => expect(onImported).toHaveBeenCalled())
    expect(importDiscovered).toHaveBeenCalledWith({ workspaceId: 'ws', source: 'cursor', names: ['github'] })
  })

  it('says so when no other tool has servers, and shows a failed import', async () => {
    ;(window as unknown as { oxe: unknown }).oxe = { mcp: { discover: async () => [] } }
    render(<McpImportPanel workspaceId={null} onImported={() => {}} onClose={() => {}} />)
    expect(await screen.findByText(/No servers found in Claude Desktop, Cursor or Windsurf/)).toBeVisible()
  })

  it('shows the reason when the import fails', async () => {
    ;(window as unknown as { oxe: unknown }).oxe = { mcp: { discover: async () => sources, importDiscovered: async () => { throw new Error('Name already taken') } } }
    render(<McpImportPanel workspaceId={null} onImported={() => {}} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'github' }))
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 server' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Name already taken')
  })

  it('keeps going past a server that cannot be added and says why', async () => {
    const importDiscovered = vi.fn(async () => ({ created: [{ name: 'github' } as never], failed: [{ name: 'docs2', reason: 'Sensitive environment blocked on an untrusted MCP server: TOKEN' }] }))
    ;(window as unknown as { oxe: unknown }).oxe = { mcp: { discover: async () => sources, importDiscovered } }
    const onImported = vi.fn(), onChanged = vi.fn()
    render(<McpImportPanel workspaceId={null} onImported={onImported} onChanged={onChanged} onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'github' }))
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 server' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not imported: docs2 (Sensitive environment blocked')
    expect(onChanged).toHaveBeenCalled()
    expect(onImported).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: 'github' })).toBeDisabled()
  })
})
