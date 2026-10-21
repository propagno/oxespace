import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mcpFailureHints } from '../shared/mcpFailureHints'
import type { McpServer } from '../shared/types/mcp'
import { ThreadMcpServerList } from '../src/components/Threads/ThreadMcpServerList'
import { mcpSessionKey, savedServerFor } from '../src/components/Threads/ThreadMcpDiagnose'

afterEach(cleanup)

describe('mcpFailureHints', () => {
  it('names a Node.js too old for the server, as on Ubuntu 24.04', () => {
    expect(mcpFailureHints({ message: 'MCP server exited', command: 'npx', node: 'v18.19.1' })[0]).toMatch(/Node\.js v18\.19\.1 is too old.*20\.19/)
    expect(mcpFailureHints({ message: 'exited', command: 'npx', node: 'v20.18.0' })).toHaveLength(1)
    expect(mcpFailureHints({ message: 'exited', command: 'npx', node: 'v22.13.0' })).toEqual([])
  })

  it('names missing required variables and a password that must be encoded', () => {
    const hints = mcpFailureHints({ message: 'exited', env: { MDB_MCP_CONNECTION_STRING: '', OTHER: 'mongodb+srv://eduardo:p@ss#1@cluster0.example.net/db' }, requiredEnv: ['MDB_MCP_CONNECTION_STRING'] })
    expect(hints[0]).toMatch(/Set MDB_MCP_CONNECTION_STRING/)
    expect(hints[1]).toMatch(/password in OTHER .* %40/)
    expect(mcpFailureHints({ message: 'x', env: { URL: 'mongodb://user:p%40ss@host/db' } })).toEqual([])
  })

  it('reads network and credential errors from the message', () => {
    expect(mcpFailureHints({ message: 'MongoServerSelectionError: Server selection timed out after 30000 ms' })[0]).toMatch(/access list/)
    expect(mcpFailureHints({ message: 'bad auth : authentication failed' })[0]).toMatch(/credentials were refused/)
    expect(mcpFailureHints({ message: 'spawn npx ENOENT', command: 'npx', node: null })[0]).toMatch(/Node\.js was not found/)
  })
})

const saved = (name: string, id = name): McpServer => ({ id, workspaceId: null, name, transport: 'stdio', config: { transport: 'stdio', command: 'npx', args: ['-y', 'mongodb-mcp-server@latest'], env: { MDB_MCP_CONNECTION_STRING: '' } }, enabled: true, trusted: true, health: 'unknown', healthMessage: null, tools: [], createdAtMs: 0, updatedAtMs: 0 })

describe('Diagnose in the MCP chip', () => {
  it('finds the saved server a session names by its slug', () => {
    expect(mcpSessionKey('MongoDB Atlas')).toBe('mongodb-atlas')
    expect(savedServerFor('mongodb-atlas-2', [saved('Other'), saved('MongoDB Atlas', 'm')])?.id).toBe('m')
    expect(savedServerFor('unknown', [saved('MongoDB')])).toBeUndefined()
  })

  it('tests a failed server and explains why it does not start', async () => {
    const diagnose = vi.fn(async () => ({ server: { ...saved('MongoDB', 'm'), health: 'unhealthy' as const, healthMessage: 'MCP server exited with code 1' }, node: 'v18.19.1' }))
    Object.defineProperty(window, 'oxe', { configurable: true, value: { mcp: { list: vi.fn(async () => [saved('MongoDB', 'm')]), diagnose } } })
    render(<ThreadMcpServerList workspaceId="w" servers={[{ name: 'mongodb', status: 'failed' }, { name: 'claude.ai Gmail', status: 'failed' }, { name: 'github', status: 'connected' }]} />)
    expect(screen.getAllByRole('button', { name: /^Diagnose/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose mongodb' }))
    expect(await screen.findByText('MCP server exited with code 1')).toBeTruthy()
    expect(diagnose).toHaveBeenCalledWith('m')
    expect(screen.getByText(/v18\.19\.1 is too old/)).toBeTruthy()
    expect(screen.getByText(/Set MDB_MCP_CONNECTION_STRING/)).toBeTruthy()
  })

  it('says when a failed server is not one OXESpace manages', async () => {
    Object.defineProperty(window, 'oxe', { configurable: true, value: { mcp: { list: vi.fn(async () => []), diagnose: vi.fn() } } })
    render(<ThreadMcpServerList workspaceId="w" servers={[{ name: 'cli-only', status: 'failed' }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Diagnose cli-only' }))
    expect(await screen.findByText(/Not managed by OXESpace/)).toBeTruthy()
  })
})
