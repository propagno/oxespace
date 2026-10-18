import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewThreadDialog } from '../src/components/Threads/ThreadDialogs'
import { useThreadStore } from '../src/store/thread.store'

const original = window.oxe
const create = vi.fn()

beforeEach(() => {
  create.mockReset()
  useThreadStore.setState({ projects: [{ projectId: 'p', displayName: 'repo', identityLabel: 'id', hidden: false, contexts: [{ rootPath: '/repo', label: 'repo' }] }] } as never)
  window.oxe = { ...original, thread: { ...original?.thread, create } } as typeof window.oxe
  vi.spyOn(useThreadStore.getState(), 'adopt').mockImplementation(() => undefined)
})
afterEach(() => { cleanup(); window.oxe = original })

describe('New thread in its own worktree', () => {
  it('sends the branch and base only when the option is chosen', async () => {
    create.mockResolvedValue({ thread: { id: 't' }, events: [] })
    const onClose = vi.fn()
    render(<NewThreadDialog initialProjectId="p" onClose={onClose} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Create in a new worktree' }))
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'fix/login' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create thread' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ projectId: 'p', rootPath: '/repo', provider: 'claude', worktree: { branch: 'fix/login' } }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('creates a plain conversation without the worktree field', async () => {
    create.mockResolvedValue({ thread: { id: 't' }, events: [] })
    render(<NewThreadDialog initialProjectId="p" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create thread' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ projectId: 'p', rootPath: '/repo', provider: 'claude' }))
  })

  it('shows the cause of a worktree refusal without the IPC prefix', async () => {
    create.mockRejectedValue(new Error("Error invoking remote method 'thread:create': ThreadWorktreeError: A branch named “taken” already exists. Choose another name."))
    render(<NewThreadDialog initialProjectId="p" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Create in a new worktree' }))
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'taken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create thread' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^A branch named “taken” already exists\. Choose another name\.$/)
  })
})
