// OXE-331 (B): while the first run waits at Step 2 after a Launch, OxeCode's view is preloaded once, at idle; never for
// a workspace made outside the first run, and never twice.
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

const preload = vi.fn(() => Promise.resolve())
vi.mock('../../../src/app/codeViewPreload', () => ({
  preloadCodeView: () => preload(),
  whenIdle: (task: () => void) => { const id = setTimeout(task, 0); return () => clearTimeout(id) }
}))
vi.mock('../../../src/store/navigation-prefs.store', () => ({ useNavigationPrefs: { getState: () => ({ completeFirstRunStep: () => undefined }) } }))
vi.mock('../../../src/store/thread.store', () => ({ useThreadStore: { getState: () => ({ loadProjects: () => Promise.resolve() }) } }))

const { useFirstRunLaunch } = await import('../../../src/app/useFirstRunLaunch')
const workspace = { rootPath: 'C:/dev/repo' }

afterEach(() => { preload.mockClear() })

describe('OXE-331 · OxeCode is warmed while the first run waits at Step 2', () => {
  test('a Launch from the first run preloads OxeCode once, at idle', async () => {
    const { result, rerender } = renderHook(() => useFirstRunLaunch())
    expect(preload).not.toHaveBeenCalled()
    await act(async () => { await result.current.create(true, () => Promise.resolve(workspace)) })
    await waitFor(() => expect(preload).toHaveBeenCalledTimes(1))
    rerender()
    await act(async () => { await result.current.create(true, () => Promise.resolve(workspace)) })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(preload).toHaveBeenCalledTimes(1)
  })

  test('a workspace made outside the first run preloads nothing', async () => {
    const { result } = renderHook(() => useFirstRunLaunch())
    await act(async () => { await result.current.create(false, () => Promise.resolve(workspace)) })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(preload).not.toHaveBeenCalled()
  })
})
