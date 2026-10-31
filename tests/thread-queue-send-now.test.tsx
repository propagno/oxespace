import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadQueuedInput } from '../shared/types/thread'
import { ThreadPromptQueue } from '../src/components/Threads/ThreadPromptQueue'

afterEach(cleanup)

const item = (id: string, text: string): ThreadQueuedInput => ({ id, text, createdAt: 0, state: 'queued' })
const handlers = () => ({ onDelete: vi.fn(async () => {}), onRestore: vi.fn(async () => {}), onReorder: vi.fn(async () => {}), onUpdate: vi.fn(async () => {}), onSendNow: vi.fn(async () => {}) })

describe('Send now in the queue', () => {
  it('sends a queued message at once when nothing is running', () => {
    const h = handlers()
    render(<ThreadPromptQueue items={[item('a', 'First'), item('b', 'Second')]} disabled={false} {...h} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Send queued input now' })[1])
    expect(h.onSendNow).toHaveBeenCalledWith('b')
  })

  it('asks before stopping a running turn to send it', () => {
    const h = handlers()
    render(<ThreadPromptQueue items={[item('a', 'Can you read the options?')]} disabled={false} running {...h} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send queued input now' }))
    expect(h.onSendNow).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Stop the current turn?' })).toHaveTextContent('Can you read the options?')
    fireEvent.click(screen.getByRole('button', { name: 'Stop and send' }))
    expect(h.onSendNow).toHaveBeenCalledWith('a')
  })
})
