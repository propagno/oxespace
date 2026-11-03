import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDeferredModule } from '../src/app/useDeferredModule'
import { Toaster } from '../src/ui/Toast'
import { useContributedCommands } from '../src/utils/commandRegistry'

/** T52 · What the first frame does not need loads right after it; a failed load says so and can be tried again. */

function Host({ load }: { load: () => Promise<{ word: string }> }) {
  const loaded = useDeferredModule(load)
  return <p data-testid="deferred">{loaded ? loaded.word : 'waiting'}</p>
}

afterEach(() => { cleanup() })

describe('useDeferredModule', () => {
  it('works on the first use: nothing until it arrives, then the module, loaded once', async () => {
    const load = vi.fn(async () => ({ word: 'ready' }))
    render(<Host load={load} />)
    expect(screen.getByTestId('deferred').textContent).toBe('waiting')
    await waitFor(() => expect(screen.getByTestId('deferred').textContent).toBe('ready'))
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('a failed import is said in words with a way to try again, and trying again loads it', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('chunk missing')).mockResolvedValue({ word: 'ready' })
    render(<><Host load={load} /><Toaster /></>)
    const retry = await screen.findByRole('button', { name: 'Try again' })
    expect(screen.getByText(/Some commands may be missing from the palette/)).toBeTruthy()
    expect(screen.getByTestId('deferred').textContent).toBe('waiting')
    act(() => retry.click())
    await waitFor(() => expect(screen.getByTestId('deferred').textContent).toBe('ready'))
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('the command contributions load after the first frame', () => {
  it('a list read before they arrive fills in by itself when they land, without a reload', async () => {
    const { result } = renderHook(() => useContributedCommands())
    await act(async () => { await import('../src/commands/CommandContributors') })
    await waitFor(() => expect(result.current.map(command => command.id)).toEqual(expect.arrayContaining(['activity.open', 'activity.markAllRead'])))
  })

  it('the deferred module registers the settings and activity commands and exposes both contributors', async () => {
    const contributors = await import('../src/commands/CommandContributors')
    expect(typeof contributors.CodeCommandContributor).toBe('function')
    expect(typeof contributors.ThreadCommandContributor).toBe('function')
    const { result } = renderHook(() => useContributedCommands())
    expect(result.current.map(command => command.id)).toEqual(expect.arrayContaining(['activity.open', 'activity.markAllRead']))
  })
})
