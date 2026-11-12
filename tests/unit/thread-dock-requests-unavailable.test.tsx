import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadRequest, ThreadSnapshot } from '../../shared/types/thread'
import { ThreadDockRequests } from '../../src/components/Threads/ThreadDockRequests'

afterEach(cleanup)

const UNAVAILABLE = /its request is unavailable/
// A conversation waiting on the person, with nothing recorded as a command or edit approval.
function waiting(events: ThreadSnapshot['events'] = []): ThreadSnapshot {
  return { thread: { id: 't', workspaceId: 'ws', projectId: 'p', rootPath: '/repo', provider: 'claude', title: 'T', status: 'approval', createdAt: 1, updatedAt: 2 }, events, turns: [] } as unknown as ThreadSnapshot
}
const question: ThreadRequest = { id: 'q', nativeId: 'q', nativeMethod: 'can_use_tool:AskUserQuestion', kind: 'question', title: 'Claude needs your input', generation: 1, createdAt: 1, state: 'pending', questions: [{ id: 'q1', header: 'Runner', question: 'Which test runner?', options: [{ label: 'Vitest', description: '' }] }] }
const dock = (snapshot: ThreadSnapshot, shown: ThreadRequest[], all: number) => render(<ThreadDockRequests snapshot={snapshot} pendingRequests={shown} waiting={all} pending={false} action={vi.fn(async () => {})} />)

describe('the notice for a request OXESpace cannot see (CHAT-14)', () => {
  it('is not shown beside a request that has its card in the conversation: a question, an MCP request', () => {
    // The card is a row of the conversation, so the dock lists nothing; one request is still waiting.
    dock(waiting([{ type: 'request', id: 'q', request: question } as unknown as ThreadSnapshot['events'][number]]), [], 1)
    expect(screen.queryByText(UNAVAILABLE)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refresh request' })).toBeNull()
  })

  it('is shown when the conversation waits and no request is there at all', () => {
    dock(waiting(), [], 0)
    expect(screen.getByText(UNAVAILABLE)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Refresh request' })).toBeVisible()
  })

  it('is not shown for a request the dock itself lists', () => {
    dock(waiting(), [question], 1)
    expect(screen.queryByText(UNAVAILABLE)).toBeNull()
  })
})
