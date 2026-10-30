import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { WorkspaceMemoryNotes, describeOrigin } from '../../src/components/Workspace/WorkspaceMemoryNotes'
import type { MemoryNote } from '../../shared/types/memory'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const note = (overrides: Partial<MemoryNote> = {}): MemoryNote => ({ path: 'decisions/oxe-00000001.md', text: 'Use pnpm for installs', scope: 'project', effectiveScope: 'project',
  trust: 'untrusted', suspicious: false, origin: { kind: 'agent', agentId: 'claude-code', threadId: 'thread-1234567', sessionId: 'session-abcdef', excerpt: 'How do we install?' },
  pinned: false, wrong: false, state: 'active', createdAt: Date.UTC(2026, 9, 1), updatedAt: Date.UTC(2026, 9, 1),
  usedBy: [{ agentId: 'codex', uses: 2, firstUsedAt: 1, lastUsedAt: Date.UTC(2026, 9, 2) }], ...overrides })
function memory(notes: MemoryNote[], extra: Record<string, unknown> = {}) {
  const api = { notes: vi.fn(async () => ({ notes, teamAllowed: true })), noteUpdate: vi.fn(async () => notes[0]), noteDelete: vi.fn(async () => ({ erased: false })),
    export: vi.fn(async () => ({ fileName: 'x.jsonl', content: '{}\n', count: 1 })), reset: vi.fn(async () => ({ scope: 'project', notesRemoved: 1, storeErased: false })), ...extra }
  vi.stubGlobal('oxe', { memory: api })
  return api
}

describe('WorkspaceMemoryNotes', () => {
  test('shows nothing when the build has no stored-memory API', () => {
    vi.stubGlobal('oxe', { memory: {} })
    const { container } = render(<WorkspaceMemoryNotes workspaceId="ws" />)
    expect(container).toBeEmptyDOMElement()
  })

  test('shows where a note came from, when, what asked for it and which agents were given it', async () => {
    memory([note()])
    render(<WorkspaceMemoryNotes workspaceId="ws" />)
    expect(await screen.findByText('Use pnpm for installs')).toBeInTheDocument()
    expect(screen.getByText(/Recorded by an agent · agent claude-code · conversation thread-1 · session session-/)).toBeInTheDocument()
    expect(screen.getByText(/Asked: How do we install\?/)).toBeInTheDocument()
    expect(screen.getByText(/Given to codex \(2×/)).toBeInTheDocument()
    expect(screen.getByText('Untrusted')).toBeInTheDocument()
    expect(describeOrigin({ origin: { kind: 'unknown' }, createdAt: 0 })).toBe('Captured by the memory service')
  })

  test('pin, mark wrong, review and expiry send exactly that change', async () => {
    const api = memory([note()])
    render(<WorkspaceMemoryNotes workspaceId="ws" />)
    await screen.findByText('Use pnpm for installs')
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))
    await waitFor(() => expect(api.noteUpdate).toHaveBeenLastCalledWith({ workspaceId: 'ws', path: 'decisions/oxe-00000001.md', patch: { pinned: true } }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark wrong' }))
    await waitFor(() => expect(api.noteUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ patch: { wrong: true } })))
    fireEvent.click(screen.getByRole('button', { name: 'I reviewed this' }))
    await waitFor(() => expect(api.noteUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ patch: { trust: 'trusted' } })))
    fireEvent.change(screen.getByLabelText('Expiry'), { target: { value: '7' } })
    await waitFor(() => expect(api.noteUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ patch: { expiresAt: expect.any(Number) } })))
  })

  test('an edit is saved as a new version, and a refusal from policy is shown', async () => {
    const api = memory([note()], { noteUpdate: vi.fn(async (input: { patch: { scope?: string } }) => { if (input.patch.scope) throw new Error('Sharing memory with the team is blocked by your organization’s policy.'); return note() }) })
    render(<WorkspaceMemoryNotes workspaceId="ws" />)
    await screen.findByText('Use pnpm for installs')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Edit note'), { target: { value: 'Use pnpm 10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as new version' }))
    await waitFor(() => expect(api.noteUpdate).toHaveBeenCalledWith(expect.objectContaining({ patch: { text: 'Use pnpm 10' } })))
    fireEvent.change(screen.getByLabelText('Who can use this note'), { target: { value: 'team' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('blocked by your organization')
  })

  test('the team choice is unavailable, with the reason, when the note cannot be shared', async () => {
    memory([note({ teamBlock: 'Only notes you wrote or reviewed can be shared with the team.' })])
    render(<WorkspaceMemoryNotes workspaceId="ws" />)
    await screen.findByText('Use pnpm for installs')
    expect(within(screen.getByLabelText('Who can use this note')).getByRole('option', { name: 'Team' })).toBeDisabled()
  })

  test('marks a note that reads like an instruction', async () => {
    memory([note({ suspicious: true })])
    render(<WorkspaceMemoryNotes workspaceId="ws" />)
    expect(await screen.findByText('Looks like an instruction')).toBeInTheDocument()
  })

  test('delete asks first and says when the page could only be hidden', async () => {
    const api = memory([note()])
    render(<WorkspaceMemoryNotes workspaceId="ws" />)
    await screen.findByText('Use pnpm for installs')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(api.noteDelete).not.toHaveBeenCalled()
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.noteDelete).toHaveBeenCalledWith({ workspaceId: 'ws', path: 'decisions/oxe-00000001.md' }))
    expect(await screen.findByText(/hidden from every agent and tool/)).toBeInTheDocument()
  })

  test('reset needs the word RESET typed', async () => {
    const api = memory([note()])
    render(<WorkspaceMemoryNotes workspaceId="ws" />)
    await screen.findByText('Use pnpm for installs')
    fireEvent.click(screen.getByRole('button', { name: /Erase all stored memory/ }))
    const confirm = await screen.findByRole('button', { name: 'Erase everything' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Type RESET to confirm'), { target: { value: 'RESET' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(api.reset).toHaveBeenCalledWith({ workspaceId: 'ws', scope: 'all', confirm: 'RESET' }))
  })

  test('search and export go through the API', async () => {
    const api = memory([note()])
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
    render(<WorkspaceMemoryNotes workspaceId="ws" />)
    await screen.findByText('Use pnpm for installs')
    fireEvent.change(screen.getByLabelText('Search stored memory'), { target: { value: 'pnpm' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(api.notes).toHaveBeenLastCalledWith({ workspaceId: 'ws', query: 'pnpm' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export all' }))
    await waitFor(() => expect(api.export).toHaveBeenCalledWith({ workspaceId: 'ws', scope: 'all' }))
    expect(await screen.findByText(/Exported 1 notes/)).toBeInTheDocument()
  })
})
