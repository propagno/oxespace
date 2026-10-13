import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThreadRewindControl } from '../src/components/Threads/ThreadRewindControl'
import { ThreadFailureCard } from '../src/components/Threads/ThreadFailureCard'
import { quoteMarkdown } from '../src/components/Threads/threadComposerState'

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
