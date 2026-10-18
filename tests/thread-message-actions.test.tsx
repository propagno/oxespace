import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThreadRewindControl } from '../src/components/Threads/ThreadRewindControl'
import { ThreadFailureCard } from '../src/components/Threads/ThreadFailureCard'
import { quoteMarkdown } from '../src/components/Threads/threadComposerState'
import { ThreadHunkReview, hunkComment } from '../src/components/Threads/ThreadHunkReview'
import { ThreadMcpHealth } from '../src/components/Threads/ThreadMcpHealth'

afterEach(cleanup)

describe('quoteMarkdown', () => {
  it('quotes every line, keeps blank lines inside the quote and bounds long text', () => {
    expect(quoteMarkdown('First\n\nSecond')).toBe('> First\n>\n> Second\n\n')
    expect(quoteMarkdown('x'.repeat(30), 10)).toBe(`> ${'x'.repeat(10)}…\n\n`)
  })
})

describe('ThreadRewindControl', () => {
  it('confirms an edit separately from a plain rewind and passes the file choice', async () => {
    const onRewind = vi.fn(async () => {}), onEdit = vi.fn(async () => {})
    render(<ThreadRewindControl laterTurns={2} disabled={false} onRewind={onRewind} onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('group', { name: 'Confirm edit' })).toHaveTextContent('the text returns to the composer')
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Rewind and edit' }))
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith({ restoreFiles: false }))
    expect(onRewind).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Rewind to here' })).toBeInTheDocument())
  })

  it('offers only rewind when editing is not available', () => {
    render(<ThreadRewindControl laterTurns={1} disabled={false} onRewind={vi.fn(async () => {})} />)
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })
})

describe('ThreadFailureCard actions', () => {
  it('offers Compact instead of Retry when the context window is full', () => {
    const onRetry = vi.fn(), onCompact = vi.fn()
    render(<ThreadFailureCard event={{ type: 'completed', status: 'failed', failure: { id: 'f', occurredAt: 1, code: 'context', message: 'Context full' } }} latest onRetry={onRetry} onCompact={onCompact} />)
    expect(screen.getByText('Context window full')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry turn' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Compact conversation' }))
    expect(onCompact).toHaveBeenCalled()
  })

  it('offers Retry for a network failure', () => {
    render(<ThreadFailureCard event={{ type: 'completed', status: 'failed', failure: { id: 'f', occurredAt: 1, code: 'network', message: 'Lost' } }} latest onRetry={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Retry turn' })).toBeInTheDocument()
  })
})

describe('ThreadHunkReview', () => {
  const hunk = { id: 'h1', oldStart: 1, oldLines: ['two\r'], newStart: 1, newLines: ['TWO\r'] }

  it('writes a review comment with the location and the quoted change', () => {
    expect(hunkComment('src/a.ts', hunk, ' Keep lowercase ')).toBe('Review comment on `src/a.ts` (lines 2–2):\n\n```diff\n-two\n+TWO\n```\n\nKeep lowercase\n')
  })

  it('undoes one change and reloads, and adds a comment to the message', async () => {
    const loadHunks = vi.fn().mockResolvedValueOnce([hunk]).mockResolvedValueOnce([])
    const onUndoHunk = vi.fn(async () => {}), onComment = vi.fn()
    render(<ThreadHunkReview path="src/a.ts" disabled={false} loadHunks={loadHunks} onUndoHunk={onUndoHunk} onComment={onComment} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Comment' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment for the agent' }), { target: { value: 'Revert this' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to message' }))
    expect(onComment).toHaveBeenCalledWith(expect.stringContaining('Revert this'))
    fireEvent.click(screen.getByRole('button', { name: 'Undo change' }))
    await waitFor(() => expect(onUndoHunk).toHaveBeenCalledWith('h1'))
    expect(await screen.findByText(/No change blocks to review here/)).toBeInTheDocument()
  })
})

describe('ThreadMcpHealth', () => {
  const thread = (servers: Array<{ name: string; status: 'connected' | 'failed' | 'needs-auth' }>) => ({ mcpServers: { servers, checkedAt: 1 } }) as never

  it('stays hidden when the session reported no servers, and counts connected ones otherwise', () => {
    const { container } = render(<ThreadMcpHealth thread={thread([])} />)
    expect(container).toBeEmptyDOMElement()
    render(<ThreadMcpHealth thread={thread([{ name: 'github', status: 'connected' }])} />)
    expect(screen.getByRole('button', { name: '1 MCP server connected' })).toHaveTextContent('MCP · 1')
  })

  it('shows how many servers are unavailable and lists them', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    render(<ThreadMcpHealth thread={thread([{ name: 'github', status: 'connected' }, { name: 'jira', status: 'needs-auth' }, { name: 'db', status: 'failed' }])} />)
    fireEvent.click(screen.getByRole('button', { name: '2 MCP servers unavailable, 1 connected' }))
    expect(await screen.findByText('Needs sign-in')).toBeInTheDocument()
    expect(screen.getByText('Failed to start')).toBeInTheDocument()
  })
})
