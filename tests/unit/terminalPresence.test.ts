import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  computePanePresence,
  paneRole,
  PRESENCE_DEBOUNCE_MS,
  reportPanePresence,
  resendPanePresence,
  resetPanePresenceReports
} from '../../src/components/Terminal/terminalPresence'
import type { WorkspacePane } from '../../shared/types/workspace'

const shown = { hostHidden: false, onScreen: true, suppressed: false, active: false, focusWithin: false }
const panes = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] as WorkspacePane[]

describe('computePanePresence (F16)', () => {
  test('the active pane of a shown workspace is focused; its siblings are visible', () => {
    expect(computePanePresence({ ...shown, active: true })).toBe('focused')
    expect(computePanePresence(shown)).toBe('visible')
  })

  test('keyboard focus inside a view outside the grid makes it focused', () => {
    expect(computePanePresence({ ...shown, focusWithin: true })).toBe('focused')
  })

  test('a hidden host (background workspace, Thread or OxeQuery), off screen or under a maximized sibling is hidden', () => {
    expect(computePanePresence({ ...shown, active: true, hostHidden: true })).toBe('hidden')
    expect(computePanePresence({ ...shown, active: true, onScreen: false })).toBe('hidden')
    expect(computePanePresence({ ...shown, active: true, suppressed: true })).toBe('hidden')
  })
})

describe('paneRole', () => {
  test('the active pane, or the first pane when the active one belongs to another workspace', () => {
    expect(paneRole(panes, 'p2', 'p2', null)).toBe('active')
    expect(paneRole(panes, 'p1', 'elsewhere', null)).toBe('active')
    expect(paneRole(panes, 'p2', 'elsewhere', null)).toBe('other')
  })

  test('a maximized sibling suppresses the others, not the maximized pane itself', () => {
    expect(paneRole(panes, 'p1', 'p3', 'p3')).toBe('suppressed')
    expect(paneRole(panes, 'p3', 'p3', 'p3')).toBe('active')
    expect(paneRole(panes, 'p1', 'p1', 'p3')).toBe('active-suppressed')
    // A maximized pane of another workspace does not touch this one.
    expect(paneRole(panes, 'p1', 'p1', 'other-ws-pane')).toBe('active')
  })

  test('a pane outside any known workspace has no role', () => {
    expect(paneRole(undefined, 'p1', 'p1', null)).toBe('other')
    expect(paneRole(panes, 'gh-embed', 'p1', null)).toBe('other')
  })
})

describe('reportPanePresence', () => {
  const setPresence = vi.fn(async () => undefined)
  beforeEach(() => {
    vi.useFakeTimers()
    resetPanePresenceReports()
    setPresence.mockClear()
    ;(window as unknown as { oxe: unknown }).oxe = { terminal: { setPresence } }
  })
  afterEach(() => { vi.useRealTimers() })

  test('sends only on change, after the debounce', () => {
    reportPanePresence('p1', 'visible')
    expect(setPresence).not.toHaveBeenCalled()
    vi.advanceTimersByTime(PRESENCE_DEBOUNCE_MS)
    expect(setPresence).toHaveBeenCalledWith({ paneId: 'p1', state: 'visible' })
    reportPanePresence('p1', 'visible')
    vi.advanceTimersByTime(PRESENCE_DEBOUNCE_MS)
    expect(setPresence).toHaveBeenCalledTimes(1)
  })

  test('a burst within the debounce sends the last state only, and nothing when it ends where it began', () => {
    reportPanePresence('p1', 'hidden')
    reportPanePresence('p1', 'visible')
    reportPanePresence('p1', 'focused')
    vi.advanceTimersByTime(PRESENCE_DEBOUNCE_MS)
    expect(setPresence.mock.calls).toEqual([[{ paneId: 'p1', state: 'focused' }]])
    reportPanePresence('p1', 'visible')
    reportPanePresence('p1', 'focused')
    vi.advanceTimersByTime(PRESENCE_DEBOUNCE_MS)
    expect(setPresence).toHaveBeenCalledTimes(1)
  })

  test('immediate sends now and drops what was waiting', () => {
    reportPanePresence('p1', 'focused')
    reportPanePresence('p1', 'hidden', true)
    expect(setPresence.mock.calls).toEqual([[{ paneId: 'p1', state: 'hidden' }]])
    vi.advanceTimersByTime(PRESENCE_DEBOUNCE_MS)
    expect(setPresence).toHaveBeenCalledTimes(1)
  })

  test('panes are deduplicated separately', () => {
    reportPanePresence('p1', 'visible', true)
    reportPanePresence('p2', 'visible', true)
    expect(setPresence).toHaveBeenCalledTimes(2)
  })

  test('resend repeats the last state for a session that started after the view', () => {
    resendPanePresence('p1')
    expect(setPresence).not.toHaveBeenCalled()
    reportPanePresence('p1', 'hidden', true)
    resendPanePresence('p1')
    expect(setPresence.mock.calls).toEqual([[{ paneId: 'p1', state: 'hidden' }], [{ paneId: 'p1', state: 'hidden' }]])
  })

  test('works without the bridge method (older preload, tests)', () => {
    ;(window as unknown as { oxe: unknown }).oxe = { terminal: {} }
    expect(() => reportPanePresence('p1', 'visible', true)).not.toThrow()
  })
})
