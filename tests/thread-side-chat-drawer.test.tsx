import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mainMessage } from '../shared/messages'
import type { ThreadSideEvent, ThreadSideOpenResult } from '../shared/types/thread'
import { applySideEvent, EMPTY_COST, initialSideChat, withQuestion } from '../src/components/Threads/side/sideChatModel'
import { sideChatCostLabel, ThreadSideChat } from '../src/components/Threads/side/ThreadSideChat'
import { i18n } from '../src/i18n'

describe('side chat model', () => {
  it('builds the answer from its deltas, does not repeat an echoed question, and adds up the cost', () => {
    let state = withQuestion({ ...initialSideChat(), phase: 'open', sideId: 's1' }, 'q1', 'What changed?')
    state = applySideEvent(state, { type: 'message', id: 'echo', role: 'user', text: 'What changed? ' })
    state = applySideEvent(state, { type: 'delta', id: 'a1', text: 'Two ' })
    state = applySideEvent(state, { type: 'delta', id: 'a1', text: 'files.' })
    state = applySideEvent(state, { type: 'tool', id: 't1', name: 'Read', state: 'running', detail: '' })
    expect(state.activity).toBe('Read')
    state = applySideEvent(state, { type: 'turn-cost', usd: 0.0125, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 300 })
    state = applySideEvent(state, { type: 'turn-cost', inputTokens: 10 })
    state = applySideEvent(state, { type: 'completed', status: 'completed' })
    expect(state.entries).toEqual([{ id: 'q1', role: 'user', text: 'What changed?' }, { id: 'a1', role: 'assistant', text: 'Two files.' }])
    expect(state.cost).toEqual({ usd: 0.0125, pricedTurns: 1, inputTokens: 1310, outputTokens: 200 })
    expect(state.busy).toBe(false)
    expect(state.activity).toBeNull()
  })
  it('a failed turn ends the wait and keeps its error', () => {
    const state = applySideEvent(withQuestion(initialSideChat(), 'q', 'x'), { type: 'completed', status: 'failed', error: 'Rate limited' })
    expect(state).toMatchObject({ busy: false, error: 'Rate limited' })
  })
  it('says the cost as price and tokens, tokens only, or nothing yet', () => {
    const t = i18n.t.bind(i18n) as unknown as (key: string, values?: Record<string, unknown>) => string
    const tt = (key: string, values?: Record<string, unknown>) => t(`thread:${key}`, values)
    expect(sideChatCostLabel(EMPTY_COST, tt)).toBe('nothing yet')
    expect(sideChatCostLabel({ usd: 0, pricedTurns: 0, inputTokens: 1500, outputTokens: 0 }, tt)).toMatch(/2k/)
    expect(sideChatCostLabel({ usd: 0.5, pricedTurns: 1, inputTokens: 1000, outputTokens: 0 }, tt)).toMatch(/US\$ 0\.50 · 1k tokens/)
  })
})

describe('side chat drawer', () => {
  let listener: ((event: ThreadSideEvent) => void) | undefined
  let open: ReturnType<typeof vi.fn<(id: string) => Promise<ThreadSideOpenResult>>>
  const sideSend = vi.fn(async () => undefined)
  const sideClose = vi.fn(async () => undefined)
  const emit = (event: ThreadSideEvent['event']): void => act(() => listener!({ sideId: 'side-1', event }))

  beforeEach(() => {
    sideSend.mockClear(); sideClose.mockClear()
    open = vi.fn(async (id: string) => ({ ok: true, side: { sideId: 'side-1', threadId: id, provider: 'claude', readOnly: true } }))
    window.oxe = { ...window.oxe, thread: { ...(window.oxe?.thread ?? {}), sideOpen: open, sideSend, sideClose,
      onSideEvent: (next: (event: ThreadSideEvent) => void) => { listener = next; return () => { listener = undefined } } } } as unknown as typeof window.oxe
  })
  afterEach(() => { cleanup() })

  it('opens a copy, asks it, shows the answer and its cost, and throws the copy away on close', async () => {
    const onClose = vi.fn()
    const { unmount } = render(<ThreadSideChat threadId="t1" onClose={onClose} />)
    expect(screen.getByRole('complementary', { name: 'Side chat' })).toHaveTextContent('Read-only copy')
    const input = screen.getByRole('textbox', { name: 'Ask the side chat' })
    await waitFor(() => expect(input).toHaveFocus())
    expect(open).toHaveBeenCalledWith('t1')
    expect(screen.getByTestId('thread-side-chat-cost')).toHaveTextContent('Cost so far: nothing yet')
    fireEvent.change(input, { target: { value: 'Why did the test fail?' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(sideSend).toHaveBeenCalledWith('side-1', 'Why did the test fail?')
    expect(screen.getByTestId('thread-side-chat-log')).toHaveTextContent('Why did the test fail?')
    expect(screen.getByRole('status')).toHaveTextContent('The copy is answering')
    emit({ type: 'message', id: 'a1', role: 'assistant', text: 'A missing fixture.' })
    emit({ type: 'turn-cost', usd: 0.02, inputTokens: 2000, outputTokens: 100 })
    emit({ type: 'completed', status: 'completed' })
    expect(screen.getByTestId('thread-side-chat-log')).toHaveTextContent('A missing fixture.')
    expect(screen.getByTestId('thread-side-chat-cost')).toHaveTextContent(/US\$ 0\.02 · 2k tokens/)
    expect(screen.queryByRole('status')).toBeNull()
    // An event for another side chat is not this one's.
    act(() => listener!({ sideId: 'other', event: { type: 'message', id: 'x', role: 'assistant', text: 'Not mine' } }))
    expect(screen.getByTestId('thread-side-chat-log')).not.toHaveTextContent('Not mine')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    unmount()
    expect(sideClose).toHaveBeenCalledWith('side-1')
  })

  it('a conversation without a session says why in the interface language, and nothing can be sent', async () => {
    open.mockResolvedValueOnce({ ok: false, message: mainMessage('thread.side.noSession', {}) })
    render(<ThreadSideChat threadId="t2" onClose={vi.fn()} />)
    expect(await screen.findByTestId('thread-side-chat-refused')).not.toHaveTextContent('thread.side')
    expect(screen.getByRole('textbox', { name: 'Ask the side chat' })).toBeDisabled()
  })

  it('a question that does not reach the copy says so, and the drawer can be asked again', async () => {
    sideSend.mockRejectedValueOnce(new Error('This side chat is closed'))
    render(<ThreadSideChat threadId="t3" onClose={vi.fn()} />)
    const input = screen.getByRole('textbox', { name: 'Ask the side chat' })
    await waitFor(() => expect(input).not.toBeDisabled())
    fireEvent.change(input, { target: { value: 'Hi' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The question did not reach the side chat')
    expect(screen.getByRole('alert')).not.toHaveTextContent('This side chat is closed')
  })
})
