// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (OXE program oxespace-152-code, phase F6, Jira OXE-185, AG-04d), the
// backend part: one cheap, debounced source of the changed-files count of a scope, shared by OxeCode and OxeChat. Written
// by the planner; the executor must not edit it. Source: the card OXE-185 (CA-2, CA-3, RN-1, RN-2, RT-2, RT-3), the
// coordination's input of 15/11 ("design one source", shared with OXE-169) and the user's rule of 15/11 ("o backend deve
// acompanhar").
// Today (main 66e0080d5) the count exists only inside the Changes panel (git.getStatus › GitControlStatus.files, read when
// the panel opens); nothing gives a count without opening it.
// Contract:
// - Main: electron/main/services/git/changed-files-count.ts exports createChangedFilesCounter({ read, debounceMs }), where
//   read(rootPath) resolves to a git status with `files` (the git service's status of that folder); counter.count(rootPath)
//   resolves to the number of files (files, never lines). Calls for the same rootPath inside the debounce window share one
//   read; another rootPath reads on its own; after the window a call reads again. A read that fails resolves to null.
// - IPC git.changedCount (window.oxe.git.changedCount({ rootPath }) → number | null) serves it from the one counter.
// - Window: src/hooks/useChangedFilesCount.ts exports useChangedFilesCount(rootPath) → number | null, the one hook both the
//   OxeCode Changes button and OxeChat's Alterações badge read (OXE-169 moves to it through a CR on OxeChat F4, asked of the
//   coordination); two components on the same rootPath show the same N from one IPC call; null rootPath asks nothing.
import { act, cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

async function counterModule(): Promise<{ createChangedFilesCounter: (options: { read: (rootPath: string) => Promise<{ files: unknown[] }>; debounceMs: number }) => { count(rootPath: string): Promise<number | null> } }> {
  return import('../../../electron/main/services/git/changed-files-count') as never
}
async function hookModule(): Promise<{ useChangedFilesCount: (rootPath: string | null) => number | null }> {
  return import('../../../src/hooks/useChangedFilesCount') as never
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('OXE-185 AG-04d one changed-files count per scope (A39)', () => {
  it('counts files from git status, one read per root inside the debounce window', async () => {
    vi.useFakeTimers()
    const { createChangedFilesCounter } = await counterModule()
    const read = vi.fn(async (rootPath: string) => ({ files: rootPath === '/repo' ? [{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'c.ts' }] : [{ path: 'x.ts' }] }))
    const counter = createChangedFilesCounter({ read, debounceMs: 500 })
    const burst = [counter.count('/repo'), counter.count('/repo'), counter.count('/repo'), counter.count('/repo-wt')]
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(await Promise.all(burst)).toEqual([3, 3, 3, 1])
    expect(read.mock.calls.map(call => call[0]).sort()).toEqual(['/repo', '/repo-wt'])
    const later = counter.count('/repo')
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(await later).toBe(3)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('a failed read is null, never 0', async () => {
    vi.useFakeTimers()
    const { createChangedFilesCounter } = await counterModule()
    const counter = createChangedFilesCounter({ read: vi.fn(async () => { throw new Error('not a git repository') }), debounceMs: 100 })
    const result = counter.count('/plain')
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(await result).toBeNull()
  })

  it('OxeCode and OxeChat read the same N for the same scope, from one call', async () => {
    const changedCount = vi.fn(async () => 7)
    Object.defineProperty(window, 'oxe', { configurable: true, value: { git: { changedCount } } })
    const { useChangedFilesCount } = await hookModule()
    const Show = ({ id, root }: { id: string; root: string | null }) => createElement('span', { 'data-testid': id }, String(useChangedFilesCount(root)))
    render(createElement('div', null, createElement(Show, { id: 'code', root: '/repo' }), createElement(Show, { id: 'chat', root: '/repo' }), createElement(Show, { id: 'none', root: null })))
    await screen.findAllByText('7')
    expect(screen.getByTestId('code')).toHaveTextContent('7')
    expect(screen.getByTestId('chat')).toHaveTextContent('7')
    expect(screen.getByTestId('none')).toHaveTextContent('null')
    expect(changedCount).toHaveBeenCalledTimes(1)
    expect(changedCount).toHaveBeenCalledWith({ rootPath: '/repo' })
  })
})
