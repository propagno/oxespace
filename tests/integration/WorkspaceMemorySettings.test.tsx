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

describe('WorkspaceMemorySettings pipeline diagnostics', () => {
  test('separates capture, delivery and consolidation, shows queue age and copies counts only', async () => {
    const now = Date.now()
    const status = { projectId: 'project', sessions: [], settings: { enabled: true, automaticCapture: true, automaticContext: false },
      runtime: { mode: 'managed', executable: 'ai-memory', url: 'http://127.0.0.1:49374' },
      health: { status: 'ready', pipeline: { capture: 'active', delivery: 'pending', consolidation: 'unknown' } },
      outbox: { pending: 3, quarantined: 1, bytes: 2048, refused: 0, stored: 5, replayed: 0, dropped: 0, failed: 2, oldestAt: now - 120_000, lastFailureAt: now - 30_000 } }
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.stubGlobal('oxe', { memory: { status: vi.fn(async () => status) } })
    render(<WorkspaceMemorySettings workspaceId="ws" />)
    const pipeline = await screen.findByLabelText('Memory pipeline')
    expect(pipeline).toHaveTextContent('Accepting events')
    expect(pipeline).toHaveTextContent('Waiting to send')
    expect(pipeline).toHaveTextContent('Unknown (not observable)')
    expect(screen.getByText(/3 pending \(oldest 2 min ago\)/)).toBeInTheDocument()
    expect(screen.getByText(/last delivery never/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const report = JSON.parse((writeText.mock.calls[0] as unknown as [string])[0])
    expect(report.outbox.pending).toBe(3)
    expect(JSON.stringify(report)).not.toMatch(/token|executable|127\.0\.0\.1/i)
  })
})

describe('WorkspaceMemorySettings resume', () => {
  const base = { projectId: 'project', sessions: [], settings: { enabled: true, automaticCapture: false, automaticContext: false },
    runtime: { mode: 'managed', executable: 'ai-memory', url: 'http://127.0.0.1:49374' }, health: { status: 'ready' } }
  const offer = (id: string, summary: string, state = 'open') => ({ id, summary, state, cwd: '/work/tree-b', nextSteps: ['Run the cursor expiry check'], openQuestions: ['Is paging stable?'], filesTouched: ['src/page.ts'] })
  test('lists offers without consuming, resumes exactly the chosen one and copies it', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    let items = [offer('h1', 'First offer'), offer('h2', 'Second offer')]
    const acceptHandoff = vi.fn(async ({ handoffId }: { handoffId: string }) => {
      const chosen = items.find(item => item.id === handoffId)!
      items = items.map(item => item.id === handoffId ? { ...item, state: 'accepted' } : item)
      return { status: 'ok', value: { ...chosen, state: 'accepted' } }
    })
    const handoffs = vi.fn(async () => ({ status: 'ok', value: items }))
    vi.stubGlobal('oxe', { memory: { status: vi.fn(async () => base), handoffs, acceptHandoff } })
    render(<WorkspaceMemorySettings workspaceId="ws" />)
    expect(await screen.findByText('First offer')).toBeInTheDocument()
    expect(screen.getByText('Second offer')).toBeInTheDocument()
    expect(acceptHandoff).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Resume' })[1])
    await waitFor(() => expect(acceptHandoff).toHaveBeenCalledWith({ workspaceId: 'ws', handoffId: 'h2' }))
    await waitFor(() => expect(screen.getByText('Accepted: Second offer')).toBeInTheDocument())
    expect(screen.getByText('First offer')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy for composer' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('read-only')))
  })
  test('explains a stale offer, refreshes the list and lets the user dismiss', async () => {
    let items = [offer('h1', 'Stale offer')]
    const handoffs = vi.fn(async () => ({ status: 'ok', value: items }))
    const acceptHandoff = vi.fn(async () => { items = []; return { status: 'unavailable', message: 'gone' } })
    vi.stubGlobal('oxe', { memory: { status: vi.fn(async () => base), handoffs, acceptHandoff } })
    render(<WorkspaceMemorySettings workspaceId="ws" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    expect(await screen.findByText(/no longer available/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/No handoff offers for this project/)).toBeInTheDocument())
  })
  test('shows an error with a retry and an empty state, and hides dismissed offers', async () => {
    const handoffs = vi.fn()
      .mockResolvedValueOnce({ status: 'unavailable', message: 'Project memory is temporarily unavailable.' })
      .mockResolvedValue({ status: 'ok', value: [offer('h1', 'Only offer')] })
    vi.stubGlobal('oxe', { memory: { status: vi.fn(async () => base), handoffs, acceptHandoff: vi.fn() } })
    render(<WorkspaceMemorySettings workspaceId="ws" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Only offer')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Only offer')).not.toBeInTheDocument()
    expect(screen.getByText(/No handoff offers/)).toBeInTheDocument()
  })
})

describe('WorkspaceMemorySettings storage', () => {
  test('shows a read-only disk inventory and a partial-scan marker', async () => {
    const status = { projectId: 'project', sessions: [], settings: { enabled: true, automaticCapture: false, automaticContext: false },
      runtime: { mode: 'managed', executable: 'ai-memory', url: 'http://127.0.0.1:49374' }, health: { status: 'ready' } }
    const storage = vi.fn(async () => ({ categories: { data: 5 * 1024 * 1024, outbox: 2048 }, totalBytes: 5 * 1024 * 1024 + 2048, truncated: true, measuredAt: Date.now() }))
    vi.stubGlobal('oxe', { memory: { status: vi.fn(async () => status), storage, handoffs: vi.fn(async () => ({ status: 'ok', value: [] })) } })
    render(<WorkspaceMemorySettings workspaceId="ws" />)
    const line = await screen.findByText(/Disk used by memory/)
    expect(line).toHaveTextContent('5.0 MiB+')
    expect(line).toHaveTextContent('data 5.0 MiB')
    expect(line).toHaveTextContent('outbox 2.0 KiB')
    expect(line).toHaveTextContent('partial scan')
    expect(line).toHaveTextContent('never deletes')
  })
})
