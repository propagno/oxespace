import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * T62: "New request" creates the request as a file and opens it; when that fails, the person is told (a danger toast,
 * which stays until dismissed), never left with a click that did nothing.
 */
const post = vi.fn()
vi.mock('../../src/components/OxePost/client', () => ({
  post: (...args: unknown[]) => post(...args),
  messageOf: (error: unknown) => error instanceof Error ? error.message : String(error),
  PostError: class PostError extends Error { code = 'failed' },
}))
const toast = vi.fn()
vi.mock('../../src/ui/Toast', () => ({ toast: (input: unknown) => toast(input) }))

const { useOxePostStore } = await import('../../src/components/OxePost/oxepost.store')

beforeEach(() => {
  post.mockReset()
  toast.mockReset()
  useOxePostStore.setState({ workspaceId: 'ws-1', selected: null, entries: [], failure: null })
})

describe('OxePost create', () => {
  it('saves a blank request with no path, then selects and lists it', async () => {
    post.mockImplementation(async (op: string) => op === 'save' ? { path: 'new-request.http' } : { requests: [{ path: 'new-request.http', name: 'New request', method: 'GET', folder: '' }], environments: [], secretsProblem: null })
    await expect(useOxePostStore.getState().create()).resolves.toBe('new-request.http')
    expect(post).toHaveBeenNthCalledWith(1, 'save', expect.objectContaining({ workspaceId: 'ws-1', path: null, folder: '' }))
    const state = useOxePostStore.getState()
    expect(state.selected).toBe('new-request.http')
    expect(state.entries.map(entry => entry.path)).toEqual(['new-request.http'])
    expect(state.draft.name).toBeTruthy()
    expect(toast).not.toHaveBeenCalled()
  })

  it('shows the error when the file cannot be written, and selects nothing', async () => {
    post.mockRejectedValue(new Error('EACCES: permission denied'))
    await expect(useOxePostStore.getState().create()).resolves.toBeNull()
    expect(useOxePostStore.getState().selected).toBeNull()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ intent: 'danger', description: 'EACCES: permission denied' }))
  })

  it('says to open a project first when none is open, without calling main', async () => {
    useOxePostStore.setState({ workspaceId: null })
    await expect(useOxePostStore.getState().create()).resolves.toBeNull()
    expect(post).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ intent: 'danger', description: expect.stringContaining('.oxespace/requests') }))
  })
})
