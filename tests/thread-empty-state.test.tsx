import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConversationThread } from '../shared/types/thread'
import { ThreadEmptyState, threadStarters } from '../src/components/Threads/ThreadEmptyState'

afterEach(cleanup)

const thread = { id: 't', provider: 'claude', rootPath: String.raw`C:\work\oxespace`, access: 'workspace-write', model: 'claude-opus' } as ConversationThread

describe('empty conversation', () => {
  it('names the agent and the project, and shows where it will work', () => {
    render(<ThreadEmptyState thread={thread} branch="feat/x" onStarter={() => {}} />)
    expect(screen.getByRole('heading')).toHaveTextContent('What should Claude work on in oxespace?')
    const context = screen.getByRole('list', { name: 'Where the agent works' })
    expect(context).toHaveTextContent('oxespace')
    expect(context).toHaveTextContent('feat/x')
    expect(context).toHaveTextContent('Can edit this project')
    expect(context).toHaveTextContent('claude-opus')
  })

  it('fills the composer with a starter instead of sending it', () => {
    const onStarter = vi.fn()
    render(<ThreadEmptyState thread={{ ...thread, access: undefined, model: undefined }} onStarter={onStarter} />)
    expect(screen.getByRole('list', { name: 'Where the agent works' })).toHaveTextContent('Read only')
    fireEvent.click(screen.getByRole('button', { name: /Review my changes/ }))
    expect(onStarter).toHaveBeenCalledWith(threadStarters()[1].prompt)
  })
})
