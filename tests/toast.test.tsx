import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { REPEAT_ANNOUNCE_MS, Toaster, dismissToast, toast, toastDuration } from '../src/ui/Toast'

const shown: number[] = []
const raise = (...args: Parameters<typeof toast>): number => { let id = 0; act(() => { id = toast(...args) }); shown.push(id); return id }
const region = (): HTMLElement => screen.getByRole('region', { name: 'Notifications' })
const toasts = (): HTMLElement[] => [...region().querySelectorAll<HTMLElement>('[data-toast]')]
/** The stack is a lazy chunk; rendering inside an async act lets it resolve. */
const mount = async (ui: ReactElement): Promise<void> => { await act(async () => { render(ui) }) }
const tick = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms) }) }

beforeAll(async () => { await import('../src/ui/ToastStack') })
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { act(() => { for (const id of shown.splice(0)) dismissToast(id) }); cleanup(); vi.useRealTimers() })

describe('toastDuration', () => {
  it('is 4 s plus about 60 ms a character, between 4 and 12 s', () => {
    expect(toastDuration({ title: '' })).toBe(4_000)
    expect(toastDuration({ title: 'Path copied' })).toBe(4_000 + 11 * 60)
    expect(toastDuration({ title: 'Saved', description: 'Your query is in the library.' })).toBe(4_000 + (5 + 29) * 60)
    expect(toastDuration({ title: 'x'.repeat(500) })).toBe(12_000)
  })
  it('keeps failures until dismissed, and a caller duration always wins', () => {
    expect(toastDuration({ title: 'Push failed', intent: 'danger' })).toBe(0)
    expect(toastDuration({ title: 'Path copied', duration: 1_500 })).toBe(1_500)
    expect(toastDuration({ title: 'Push failed', intent: 'danger', duration: 8_000 })).toBe(8_000)
    expect(toastDuration({ title: 'Kept', duration: 0 })).toBe(0)
  })
})

describe('Toaster', () => {
  it('is always in the page as a polite region; only failures are assertive', async () => {
    await mount(<Toaster />)
    expect(region()).toHaveAttribute('aria-live', 'polite')
    expect(region()).toBeEmptyDOMElement()
    raise({ title: 'Committed', intent: 'success' })
    raise({ title: 'Branch is behind', intent: 'warning' })
    raise({ title: 'Push failed', intent: 'danger' })
    const [success, warning, danger] = toasts()
    expect(success).not.toHaveAttribute('role')
    expect(warning).not.toHaveAttribute('role')
    expect(danger).toHaveAttribute('role', 'alert')
    expect(screen.getAllByRole('alert')).toEqual([danger])
  })

  it('never takes focus when it appears', async () => {
    await mount(<><button type="button">Editor</button><Toaster /></>)
    const editor = screen.getByRole('button', { name: 'Editor' })
    editor.focus()
    raise({ title: 'Saved', action: { label: 'Undo', run: () => {} } })
    raise({ title: 'Push failed', intent: 'danger' })
    expect(document.activeElement).toBe(editor)
  })

  it('merges a repeat into the toast showing, with a count, and restarts its timer', async () => {
    await mount(<Toaster />)
    const duration = toastDuration({ title: 'Path copied' })
    const first = raise({ title: 'Path copied', intent: 'success' })
    tick(duration - 100)
    for (let i = 0; i < 3; i++) expect(raise({ title: 'Path copied', intent: 'success' })).toBe(first)
    expect(toasts()).toHaveLength(1)
    expect(within(toasts()[0]).getByText('×4')).toHaveAttribute('aria-hidden', 'true')
    tick(duration - 100)
    expect(toasts()).toHaveLength(1)
    tick(200)
    expect(toasts()).toHaveLength(0)
  })

  it('keeps toasts that differ in intent or description apart', async () => {
    await mount(<Toaster />)
    raise({ title: 'Path copied', intent: 'success' })
    raise({ title: 'Path copied', intent: 'info' })
    raise({ title: 'Path copied', intent: 'success', description: 'C:/projects' })
    expect(toasts()).toHaveLength(3)
    expect(screen.queryByText(/×/)).toBeNull()
  })

  it('announces a burst of repeats once, with the final count', async () => {
    await mount(<Toaster />)
    raise({ title: 'Text copied', intent: 'success' })
    const spoken = toasts()[0].querySelector('.sr-only')!
    const observer = new MutationObserver(() => {})
    observer.observe(spoken, { childList: true, characterData: true, subtree: true })
    for (let i = 0; i < 3; i++) { tick(100); raise({ title: 'Text copied', intent: 'success' }) }
    expect(spoken).toHaveTextContent('')
    tick(REPEAT_ANNOUNCE_MS - 1)
    expect(spoken).toHaveTextContent('')
    tick(1)
    expect(spoken).toHaveTextContent('Repeated 4 times')
    expect(observer.takeRecords()).toHaveLength(1)
    observer.disconnect()
  })

  it('pauses while the pointer is over the stack and resumes with the time left', async () => {
    await mount(<Toaster />)
    const duration = toastDuration({ title: 'Committed' })
    raise({ title: 'Committed', intent: 'success' })
    tick(1_000)
    fireEvent.mouseEnter(region())
    tick(60_000)
    expect(toasts()).toHaveLength(1)
    fireEvent.mouseLeave(region())
    tick(duration - 1_000 - 50)
    expect(toasts()).toHaveLength(1)
    tick(100)
    expect(toasts()).toHaveLength(0)
  })

  it('pauses while focus is inside the stack', async () => {
    await mount(<><button type="button">Editor</button><Toaster /></>)
    raise({ title: 'Committed', intent: 'success' })
    act(() => { screen.getByRole('button', { name: 'Dismiss notification' }).focus() })
    tick(60_000)
    expect(toasts()).toHaveLength(1)
    act(() => { screen.getByRole('button', { name: 'Editor' }).focus() })
    tick(toastDuration({ title: 'Committed' }) + 10)
    expect(toasts()).toHaveLength(0)
  })

  it('has a named close button on every toast', async () => {
    await mount(<Toaster />)
    raise({ title: 'Committed', intent: 'success' })
    raise({ title: 'Push failed', intent: 'danger' })
    const close = screen.getAllByRole('button', { name: 'Dismiss notification' })
    expect(close).toHaveLength(2)
    fireEvent.click(close[1])
    expect(screen.queryByText('Push failed')).toBeNull()
    expect(screen.getByText('Committed')).toBeInTheDocument()
  })

  it('closes the focused toast on Escape and hands focus on without losing it', async () => {
    await mount(<><button type="button">Editor</button><Toaster /></>)
    const editor = screen.getByRole('button', { name: 'Editor' })
    raise({ title: 'First', intent: 'danger' })
    raise({ title: 'Second', intent: 'danger' })
    editor.focus()
    const [first, second] = screen.getAllByRole('button', { name: 'Dismiss notification' })
    act(() => { first.focus() })
    fireEvent.keyDown(first, { key: 'Escape' })
    expect(screen.queryByText('First')).toBeNull()
    expect(document.activeElement).toBe(second)
    fireEvent.keyDown(second, { key: 'Escape' })
    expect(toasts()).toHaveLength(0)
    expect(document.activeElement).toBe(editor)
  })

  it('ignores Escape from outside the stack', async () => {
    await mount(<><button type="button">Editor</button><Toaster /></>)
    raise({ title: 'Push failed', intent: 'danger' })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Editor' }), { key: 'Escape' })
    expect(toasts()).toHaveLength(1)
  })
})
