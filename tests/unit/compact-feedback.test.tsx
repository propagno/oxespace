import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadSnapshot } from '../../shared/types/thread'
import { useCompactFeedback } from '../../src/components/Threads/useCompactFeedback'
import { Toaster } from '../../src/ui'

afterEach(cleanup)

function Probe({ snapshot }: { snapshot: ThreadSnapshot | null }) { useCompactFeedback(snapshot); return <Toaster /> }

const conversation = (text: string, status: 'running' | 'completed' | 'interrupted', percentage?: number): ThreadSnapshot => ({
  thread: { id: 't', workspaceId: 'ws', projectId: 'p', rootPath: '/repo', provider: 'claude', title: 'T', status: status === 'running' ? 'running' : 'idle', createdAt: 1, updatedAt: 2,
    ...(percentage === undefined ? {} : { contextReport: { percentage, usedTokens: percentage * 2000, windowTokens: 200000 } }) },
  events: [{ type: 'message', id: 'turn-1', role: 'user', text }],
  turns: [{ id: 'turn-1', sequence: 1, status, configuration: {} }]
}) as unknown as ThreadSnapshot

describe('what a Compact did (CHAT-18)', () => {
  it('says how much of the window the context took before and takes now', async () => {
    const contextUsage = vi.fn(async () => ({ percentage: 18, usedTokens: 36000, windowTokens: 200000 }))
    Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, thread: { contextUsage } } })
    const view = render(<Probe snapshot={conversation('/compact', 'running', 62)} />)
    expect(contextUsage).not.toHaveBeenCalled()
    view.rerender(<Probe snapshot={conversation('/compact', 'completed', 62)} />)
    expect(await screen.findByText('Conversation compacted: the context went from 62% to 18% of the window.')).toBeVisible()
    expect(contextUsage).toHaveBeenCalledWith('t')
  })

  it('without the numbers it still says the conversation was compacted', async () => {
    Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, thread: { contextUsage: vi.fn(async () => null) } } })
    const view = render(<Probe snapshot={conversation('/compact', 'running')} />)
    view.rerender(<Probe snapshot={conversation('/compact', 'completed')} />)
    expect(await screen.findByText('Conversation compacted.')).toBeVisible()
  })

  it('says nothing for another turn, for a Compact that was stopped, or for one that was already finished when the conversation opened', async () => {
    const contextUsage = vi.fn(async () => ({ percentage: 18, usedTokens: 36000, windowTokens: 200000 }))
    Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, thread: { contextUsage } } })
    const other = render(<Probe snapshot={conversation('Fix the price', 'running', 62)} />)
    other.rerender(<Probe snapshot={conversation('Fix the price', 'completed', 62)} />)
    other.unmount()
    const stopped = render(<Probe snapshot={conversation('/compact', 'running', 62)} />)
    stopped.rerender(<Probe snapshot={conversation('/compact', 'interrupted', 62)} />)
    stopped.unmount()
    render(<Probe snapshot={conversation('/compact', 'completed', 62)} />)
    await waitFor(() => expect(contextUsage).not.toHaveBeenCalled())
    expect(screen.queryByText(/Conversation compacted/)).toBeNull()
  })
})
