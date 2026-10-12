// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ThreadRequestCard } from '../src/components/Threads/ThreadRequestCard'
import type { ThreadRequest } from '../shared/types/thread'

afterEach(cleanup)
it('reviews multiple answers, preserves a draft after remount and failure, and sends only once', async () => {
  const request: ThreadRequest = { id: 'grill', nativeId: 'grill', nativeMethod: 'AskUserQuestion', kind: 'question', title: 'Refinement', state: 'pending', generation: 1, createdAt: 42,
    questions: [{ id: 'db', question: 'Database?', options: [{ label: 'Postgres' }, { label: 'SQLite' }] }, { id: 'features', question: 'Features?', multiple: true, options: [{ label: 'Search' }, { label: 'Export' }] }] }
  const respond = vi.fn().mockRejectedValueOnce(Error('Connection unavailable')).mockResolvedValue(undefined)
  const component = <ThreadRequestCard conversationId="isolated-thread" request={request} disabled={false} onRespond={respond} />
  let view = render(component)
  fireEvent.click(screen.getByRole('radio', { name: 'Postgres' }))
  view.unmount(); view = render(component)
  expect((screen.getByRole('radio', { name: 'Postgres' }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Search' }))
  fireEvent.change(screen.getByLabelText('Other answer: Features?'), { target: { value: 'Offline' } })
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
  expect(screen.getByText('Question 1 of 2')).toBeTruthy()
  const answer = screen.getByRole('button', { name: 'Answer', exact: true })
  fireEvent.click(answer); fireEvent.click(answer)
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Connection unavailable'))
  expect(respond).toHaveBeenCalledTimes(1)
  fireEvent.click(answer)
  await waitFor(() => expect(respond).toHaveBeenCalledTimes(2))
  expect(respond).toHaveBeenLastCalledWith({ answers: { db: ['Postgres'], features: ['Search', 'Offline'] } })
  view.unmount()
})
