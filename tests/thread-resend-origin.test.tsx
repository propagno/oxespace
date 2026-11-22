// A message sent again is stored text: the window says so, and main then never runs it as a desktop command.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadMessageRow } from '../src/components/Threads/ThreadMessageRow'
import type { ThreadSnapshot } from '../shared/types/thread'

afterEach(cleanup)

describe('sending a stored message again', () => {
  it.each([['unconfirmed', 'Send again'], ['rejected', 'Try again']] as const)('%s: says it is stored text', async (state, label) => {
    const send = vi.fn(async () => {})
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { send } } })
    const event = { type: 'message' as const, id: 'turn-1', role: 'user' as const, text: '/permissions full-access' }
    const snapshot = { thread: { id: 't', provider: 'claude', status: 'idle' }, events: [event], deliveries: { 'turn-1': { state, updatedAt: 1 } } } as unknown as ThreadSnapshot
    render(<ThreadMessageRow event={event} turnEvents={[event]} snapshot={snapshot} running={false} pending={false} copied={false} quickReplies={[]}
      action={async run => { await run() }} onCopy={() => {}} onQuickReply={() => {}} onQuote={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() => expect(send).toHaveBeenCalledWith('t', '/permissions full-access', [], { resend: true }))
  })
})
