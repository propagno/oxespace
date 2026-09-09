import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorkspaceMemorySettings } from '../../src/components/Workspace/WorkspaceMemorySettings'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('WorkspaceMemorySettings', () => {
  test('is optional even when a preview has no Electron preload', () => {
    vi.stubGlobal('oxe', undefined)
    render(<WorkspaceMemorySettings workspaceId="ws" />)
    expect(screen.getByText('Shared Project Memory')).toBeInTheDocument()
  })
  test('requires explicit apply and agent setup actions, never installs on mount', async () => {
    const status = { projectId: 'project', health: { status: 'disabled' }, sessions: [],
      settings: { enabled: false, automaticCapture: false, automaticContext: false },
      runtime: { mode: 'managed', executable: 'ai-memory', url: 'http://127.0.0.1:49374' } }
    const memory = { status: vi.fn(async () => status), configure: vi.fn(async () => status), install: vi.fn(), setupAgents: vi.fn() }
    vi.stubGlobal('oxe', { memory })
    render(<WorkspaceMemorySettings workspaceId="ws" />)
    await waitFor(() => expect(screen.getByText(/Project: project/)).toBeInTheDocument())
    expect(memory.install).not.toHaveBeenCalled()
    expect(memory.setupAgents).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Enabled'))
    expect(memory.configure).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Apply memory settings' }))
    await waitFor(() => expect(memory.configure).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws', settings: { enabled: true, automaticCapture: false, automaticContext: false } })))
    await waitFor(() => expect(screen.getByText(/Settings saved. Memory is disabled/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Configure Claude / Codex' })).toBeDisabled()
  })
  test('reports a failed startup and prevents agent setup with unapplied runtime changes', async () => {
    const status = { projectId: 'project', health: { status: 'ready' }, sessions: [],
      settings: { enabled: true, automaticCapture: false, automaticContext: false },
      runtime: { mode: 'managed', executable: 'ai-memory', url: 'http://127.0.0.1:49374' } }
    const memory = { status: vi.fn(async () => status), install: vi.fn(async () => '/download/ai-memory'),
      configure: vi.fn(async () => ({ ...status, health: { status: 'unavailable', message: 'Cannot launch AI Memory (ENOENT)' } })), setupAgents: vi.fn() }
    vi.stubGlobal('oxe', { memory })
    render(<WorkspaceMemorySettings workspaceId="ws" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Configure Claude / Codex' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Download local runtime' }))
    await waitFor(() => expect(screen.getByDisplayValue('/download/ai-memory')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Configure Claude / Codex' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Apply memory settings' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ENOENT'))
    expect(memory.configure).toHaveBeenCalledWith(expect.objectContaining({ runtime: expect.objectContaining({ executable: '/download/ai-memory' }) }))
    expect(memory.setupAgents).not.toHaveBeenCalled()
  })
})
