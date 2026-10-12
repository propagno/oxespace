import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ThreadPromptQueue } from '../src/components/Threads/ThreadPromptQueue'

afterEach(cleanup)

it('explains uncertain delivery and lets the user dismiss the local queue record', () => {
  const remove = vi.fn(async () => {})
  render(<ThreadPromptQueue items={[{ id: 'uncertain', text: 'Continue the audit', createdAt: 1, state: 'unknown', error: 'Delivery could not be confirmed after OXESpace restarted.' }]} disabled={false} onDelete={remove} onRestore={vi.fn()} onReorder={vi.fn()} onUpdate={vi.fn()} />)
  expect(screen.getByText(/Delivery could not be confirmed/)).toBeVisible()
  const dismiss = screen.getByRole('button', { name: 'Dismiss input with unknown delivery' })
  expect(dismiss).toHaveAttribute('title', 'Remove this local record without retrying it')
  fireEvent.click(dismiss)
  expect(remove).toHaveBeenCalledWith('uncertain')
})

it('does not allow a currently sending item to be restored', () => {
  render(<ThreadPromptQueue items={[{ id: 'sending', text: 'Continue', createdAt: 1, state: 'sending' }]} disabled={false} onDelete={vi.fn()} onRestore={vi.fn()} onReorder={vi.fn()} onUpdate={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Return queued input to draft' })).toBeDisabled()
})

it('returns a queued input to the draft with its captured state', () => {
  const restore = vi.fn(async () => {})
  const item = { id: 'queued', text: 'Continue', createdAt: 1, state: 'queued' as const, configuration: { model: 'gpt', reasoningEffort: 'high' }, attachments: [{ id: 'image', name: 'screen.png', mimeType: 'image/png' as const, bytes: 42 }] }
  render(<ThreadPromptQueue items={[item]} disabled={false} onDelete={vi.fn()} onRestore={restore} onReorder={vi.fn()} onUpdate={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Return queued input to draft' }))
  expect(restore).toHaveBeenCalledWith(item)
})
