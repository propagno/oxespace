import { act, render, screen } from '@testing-library/react'
import { useRef, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useTerminalPresence } from '../../src/components/Terminal/useTerminalPresence'
import { PRESENCE_DEBOUNCE_MS, resetPanePresenceReports } from '../../src/components/Terminal/terminalPresence'
import { useUIStore } from '../../src/store/ui.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'
import type { Workspace } from '../../shared/types/workspace'

function Probe({ paneId, workspaceId, report = true }: { paneId: string; workspaceId?: string; report?: boolean }): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const { presence } = useTerminalPresence({ paneId, workspaceId, hostRef, report })
  return <div ref={hostRef} data-testid={paneId} data-presence={presence} tabIndex={-1} />
}

function Workspaces({ hidden, show = ['w1', 'w2'] }: { hidden: Record<string, boolean>; show?: string[] }): ReactElement {
  return (
    <>
      {show.includes('w1') && <div className={`workspace-host${hidden.w1 ? ' workspace-host-hidden' : ''}`}><Probe paneId="p1" workspaceId="w1" /><Probe paneId="p2" workspaceId="w1" /></div>}
      {show.includes('w2') && <div className={`workspace-host${hidden.w2 ? ' workspace-host-hidden' : ''}`}><Probe paneId="q1" workspaceId="w2" /></div>}
    </>
  )
}

const presenceOf = (paneId: string): string | null => screen.getByTestId(paneId).getAttribute('data-presence')
// Mutation observers report on a microtask; the presence they produce goes out after the debounce.
const flush = async (): Promise<void> => {
  await act(async () => { await Promise.resolve() })
  await act(async () => { vi.advanceTimersByTime(PRESENCE_DEBOUNCE_MS) })
}

let intersection: Map<Element, IntersectionObserverCallback>
const setPresence = vi.fn(async () => undefined)
const lastSent = (paneId: string): string | undefined =>
  (setPresence.mock.calls as unknown as Array<[{ paneId: string; state: string }]>).filter(([input]) => input.paneId === paneId).at(-1)?.[0].state

describe('useTerminalPresence (F16)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetPanePresenceReports()
    setPresence.mockClear()
    ;(window as unknown as { oxe: unknown }).oxe = { terminal: { setPresence } }
    intersection = new Map()
    global.IntersectionObserver = class {
      constructor(private readonly callback: IntersectionObserverCallback) {}
      observe(target: Element): void { intersection.set(target, this.callback) }
      disconnect(): void {}
      unobserve(): void {}
      takeRecords(): IntersectionObserverEntry[] { return [] }
    } as unknown as typeof IntersectionObserver
    useWorkspaceStore.setState({ workspaces: [
      { id: 'w1', panes: [{ id: 'p1' }, { id: 'p2' }] },
      { id: 'w2', panes: [{ id: 'q1' }] }
    ] as unknown as Workspace[] })
    useUIStore.setState({ activePaneId: 'p1', maximizedPaneId: null })
  })
  afterEach(() => { vi.useRealTimers() })

  test('active pane focused, sibling visible, background workspace hidden; each sent once', async () => {
    render(<Workspaces hidden={{ w2: true }} />)
    await flush()
    expect([presenceOf('p1'), presenceOf('p2'), presenceOf('q1')]).toEqual(['focused', 'visible', 'hidden'])
    expect([lastSent('p1'), lastSent('p2'), lastSent('q1')]).toEqual(['focused', 'visible', 'hidden'])
    expect(setPresence).toHaveBeenCalledTimes(3)
  })

  test('workspace switch: the old workspace goes hidden, the new one shows with its first pane focused', async () => {
    const view = render(<Workspaces hidden={{ w2: true }} />)
    await flush()
    setPresence.mockClear()
    view.rerender(<Workspaces hidden={{ w1: true }} />)
    await flush()
    expect([presenceOf('p1'), presenceOf('p2'), presenceOf('q1')]).toEqual(['hidden', 'hidden', 'focused'])
    expect(setPresence).toHaveBeenCalledTimes(3)
  })

  test('view switch (Thread/OxeQuery hides every host) and back', async () => {
    const view = render(<Workspaces hidden={{ w2: true }} />)
    await flush()
    view.rerender(<Workspaces hidden={{ w1: true, w2: true }} />)
    await flush()
    expect([lastSent('p1'), lastSent('p2')]).toEqual(['hidden', 'hidden'])
    view.rerender(<Workspaces hidden={{ w2: true }} />)
    await flush()
    expect([lastSent('p1'), lastSent('p2')]).toEqual(['focused', 'visible'])
  })

  test('maximize hides the siblings and restore shows them again', async () => {
    render(<Workspaces hidden={{ w2: true }} />)
    await flush()
    act(() => useUIStore.setState({ activePaneId: 'p2', maximizedPaneId: 'p2' }))
    await flush()
    expect([presenceOf('p1'), presenceOf('p2')]).toEqual(['hidden', 'focused'])
    act(() => useUIStore.setState({ maximizedPaneId: null }))
    await flush()
    expect([lastSent('p1'), lastSent('p2')]).toEqual(['visible', 'focused'])
  })

  test('a view that leaves the screen (closed panel, scrolled away) is hidden', async () => {
    render(<Workspaces hidden={{ w2: true }} />)
    await flush()
    const target = screen.getByTestId('p2')
    act(() => intersection.get(target)?.([{ isIntersecting: false, target } as unknown as IntersectionObserverEntry], {} as IntersectionObserver))
    await flush()
    expect(lastSent('p2')).toBe('hidden')
  })

  test('keyboard focus inside a view outside any workspace makes it focused', async () => {
    render(<Probe paneId="gh" />)
    await flush()
    expect(lastSent('gh')).toBe('visible')
    act(() => screen.getByTestId('gh').focus())
    await flush()
    expect(lastSent('gh')).toBe('focused')
  })

  test('unmount sends hidden at once', async () => {
    const view = render(<Workspaces hidden={{ w2: true }} />)
    await flush()
    view.rerender(<Workspaces hidden={{ w2: true }} show={['w2']} />)
    expect([lastSent('p1'), lastSent('p2')]).toEqual(['hidden', 'hidden'])
  })

  test('without report nothing reaches the main process (Thread native CLI)', async () => {
    render(<Probe paneId="native" report={false} />)
    await flush()
    expect(setPresence).not.toHaveBeenCalled()
  })
})
