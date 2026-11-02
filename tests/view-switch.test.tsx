import { act, cleanup, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SKELETON_AFTER_MS, useViewSwitch } from '../src/app/viewSwitch'
import { ModeSwitch } from '../src/components/Navigation/ModeSwitch'
import type { AppView } from '../src/keyboard/keybindings'

// The view chunks: OxeQuery's is controlled by the test, so a switch can be slow or fast at will.
let release: () => void = () => undefined
let loaded = false
vi.mock('../src/components/Navigation/ModeViews', () => ({
  VIEW_CHUNKS: {
    data: { load: () => new Promise<void>(resolve => { release = () => { loaded = true; resolve() } }), get: () => (loaded ? {} : undefined) }
  }
}))

function Harness({ onCommit, skeleton = false }: { onCommit: (view: AppView) => void; skeleton?: boolean }) {
  const [view, setView] = useState<AppView>('code')
  const { select } = useViewSwitch(view, next => { onCommit(next); setView(next) })
  return <>
    <ModeSwitch mode={view} onSelect={select} />
    <div data-view={view} data-testid="current">{view}{skeleton && view === 'data' && <span data-view-skeleton="" />}</div>
  </>
}

beforeEach(() => { vi.useFakeTimers(); loaded = false; document.querySelectorAll('[aria-live]').forEach(node => node.replaceChildren()) })
afterEach(() => { cleanup(); vi.useRealTimers() })
const button = (name: string) => screen.getByRole('button', { name })

describe('switching views (F7.2, docs/design/motion.md)', () => {
  // The view's chunk starts loading after the selected button has painted (a frame, advanced with the timers).
  it('the button is selected and busy at once; the current view stays until the next one is ready', async () => {
    const commit = vi.fn()
    render(<Harness onCommit={commit} />)
    act(() => { button('OxeQuery').click() })
    expect(button('OxeQuery')).toHaveAttribute('aria-pressed', 'true')
    expect(button('OxeQuery')).toHaveAttribute('aria-busy', 'true')
    expect(button('OxeCode')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('current')).toHaveTextContent('code')
    await act(async () => { vi.advanceTimersByTime(20); await vi.dynamicImportSettled(); await Promise.resolve(); release(); await Promise.resolve(); await Promise.resolve() })
    expect(commit).toHaveBeenCalledWith('data')
    expect(screen.getByTestId('current')).toHaveTextContent('data')
    expect(button('OxeQuery')).toHaveAttribute('aria-busy', 'false')
  })

  it('past 300 ms it commits anyway, so the new view can show its own skeleton', async () => {
    const commit = vi.fn()
    render(<Harness onCommit={commit} />)
    act(() => { button('OxeQuery').click() })
    await act(async () => { vi.advanceTimersByTime(SKELETON_AFTER_MS - 1) })
    expect(commit).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(commit).toHaveBeenCalledWith('data')
  })

  it('the latest choice wins, and a view already loaded switches without waiting', async () => {
    const commit = vi.fn()
    render(<Harness onCommit={commit} />)
    act(() => { button('OxeQuery').click() })
    act(() => { button('OxeCode').click() })
    expect(button('OxeCode')).toHaveAttribute('aria-pressed', 'true')
    await act(async () => { vi.advanceTimersByTime(SKELETON_AFTER_MS * 2) })
    expect(commit).not.toHaveBeenCalled()
    expect(screen.getByTestId('current')).toHaveTextContent('code')
  })

  it('announces the view and moves focus into it at the commit, not at the click', async () => {
    render(<Harness onCommit={() => undefined} />)
    act(() => { button('OxeQuery').click() })
    expect(document.querySelector('[data-testid="focus-announcer"], [aria-live="polite"]')?.textContent ?? '').not.toContain('OxeQuery')
    await act(async () => { vi.advanceTimersByTime(20); await vi.dynamicImportSettled(); await Promise.resolve(); release(); await Promise.resolve(); await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(20) })
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('OxeQuery')
    expect(screen.getByTestId('current')).toHaveFocus()
  })

  it('leaves focus in a dialog the switch opened, and still announces the view (oxepod e2e: Connect in OxeQuery)', async () => {
    render(<><Harness onCommit={() => undefined} /><div role="dialog" aria-label="New connection"><input aria-label="Password" /></div></>)
    act(() => { button('OxeQuery').click() })
    act(() => { screen.getByLabelText('Password').focus() })
    await act(async () => { vi.advanceTimersByTime(20); await vi.dynamicImportSettled(); await Promise.resolve(); release(); await Promise.resolve(); await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(20) })
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('OxeQuery')
    expect(screen.getByLabelText('Password')).toHaveFocus()
  })

  it('on the slow path, focus and the announcement wait for the content, not the skeleton (#363 review M1)', async () => {
    const { rerender } = render(<Harness onCommit={() => undefined} skeleton />)
    act(() => { button('OxeQuery').click() })
    await act(async () => { vi.advanceTimersByTime(SKELETON_AFTER_MS + 50) })
    expect(screen.getByTestId('current')).toHaveTextContent('data')
    expect(document.querySelector('[aria-live="polite"]')?.textContent ?? '').not.toBe('OxeQuery')
    expect(screen.getByTestId('current')).not.toHaveFocus()
    rerender(<Harness onCommit={() => undefined} skeleton={false} />)
    await act(async () => { await Promise.resolve(); vi.advanceTimersByTime(20) })
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('OxeQuery')
    expect(screen.getByTestId('current')).toHaveFocus()
  })
})
