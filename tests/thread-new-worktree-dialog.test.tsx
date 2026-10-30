import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewThreadDialog } from '../src/components/Threads/ThreadDialogs'
import { useThreadStore } from '../src/store/thread.store'

const original = window.oxe
const create = vi.fn()

beforeEach(() => {
  create.mockReset()
  window.localStorage.clear()
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
    fireEvent.click(screen.getByRole('checkbox', { name: 'Work in an isolated worktree' }))
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

  it('starts off, remembers the choice for the project and offers it again next time', async () => {
    create.mockResolvedValue({ thread: { id: 't' }, events: [] })
    const first = render(<NewThreadDialog initialProjectId="p" onClose={() => {}} />)
    expect(screen.getByRole('checkbox', { name: 'Work in an isolated worktree' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Work in an isolated worktree' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create thread' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    first.unmount()
    render(<NewThreadDialog initialProjectId="p" onClose={() => {}} />)
    expect(screen.getByRole('checkbox', { name: 'Work in an isolated worktree' })).toBeChecked()
  })

  it('turning it off for the next conversation is remembered too', async () => {
    create.mockResolvedValue({ thread: { id: 't' }, events: [] })
    window.localStorage.setItem('oxe.thread.worktreeDefault', JSON.stringify({ p: true }))
    const first = render(<NewThreadDialog initialProjectId="p" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Work in an isolated worktree' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create thread' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ projectId: 'p', rootPath: '/repo', provider: 'claude' }))
    first.unmount()
    render(<NewThreadDialog initialProjectId="p" onClose={() => {}} />)
    expect(screen.getByRole('checkbox', { name: 'Work in an isolated worktree' })).not.toBeChecked()
  })

  it('explains a refusal and falls back to the project folder only when asked', async () => {
    create.mockRejectedValueOnce(new Error("Error invoking remote method 'thread:create': Error: [thread-worktree:NOT_A_REPO] /repo is not a Git repository, so it cannot have a worktree."))
    create.mockResolvedValueOnce({ thread: { id: 't' }, events: [] })
    const onClose = vi.fn()
    render(<NewThreadDialog initialProjectId="p" onClose={onClose} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Work in an isolated worktree' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create thread' }))
    expect(await screen.findByText('This folder is not a Git repository, so it cannot have a worktree.')).toBeInTheDocument()
    expect(create).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Use the project folder instead' }))
    await waitFor(() => expect(create).toHaveBeenLastCalledWith({ projectId: 'p', rootPath: '/repo', provider: 'claude' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    // The fallback was a one-time answer: the project is still set to use worktrees.
    expect(JSON.parse(window.localStorage.getItem('oxe.thread.worktreeDefault') ?? '{}')).toEqual({})
  })

  it('lets uncommitted changes in the project be left behind after saying so', async () => {
    create.mockRejectedValueOnce(new Error('[thread-worktree:DIRTY_BASE] The project has uncommitted changes; a new worktree starts from main without them.'))
    create.mockResolvedValueOnce({ thread: { id: 't' }, events: [] })
    render(<NewThreadDialog initialProjectId="p" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Work in an isolated worktree' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create thread' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Create it anyway' }))
    await waitFor(() => expect(create).toHaveBeenLastCalledWith({ projectId: 'p', rootPath: '/repo', provider: 'claude', worktree: { allowDirtyBase: true } }))
  })

  it('shows the cause of a worktree refusal without the IPC prefix', async () => {
    create.mockRejectedValue(new Error("Error invoking remote method 'thread:create': ThreadWorktreeError: A branch named “taken” already exists. Choose another name."))
    render(<NewThreadDialog initialProjectId="p" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Work in an isolated worktree' }))
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'taken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create thread' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^A branch named “taken” already exists\. Choose another name\.$/)
  })
})
