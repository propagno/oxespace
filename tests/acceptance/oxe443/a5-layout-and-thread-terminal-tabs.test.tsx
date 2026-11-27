import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  isTerminalHostHidden,
  observeTerminalVisibility,
  resolveWorkspaceSurfaceVisibility
} from '../../../src/components/Terminal/terminalVisibility'
import { ThreadProjectTerminal } from '../../../src/components/Threads/ThreadProjectTerminal'
import type { ConversationThread } from '../../../shared/types/thread'

const mountCounts = new Map<string, number>()
const unmountCounts = new Map<string, number>()

vi.mock('../../../src/components/Panes/TerminalPane', () => ({
  TerminalPane: ({ pane }: { pane: { id: string } }) => {
    useEffect(() => {
      mountCounts.set(pane.id, (mountCounts.get(pane.id) ?? 0) + 1)
      return () => {
        unmountCounts.set(pane.id, (unmountCounts.get(pane.id) ?? 0) + 1)
      }
    }, [pane.id])
    return <div data-testid={`mock-pane-${pane.id}`}>{pane.id}</div>
  }
}))

describe('OXE-443 A5 · App layout stability across views and persistent ThreadProjectTerminal tabs', () => {
  beforeEach(() => {
    mountCounts.clear()
    unmountCounts.clear()
    window.oxe = {
      app: { version: '1.6.3', platform: 'win32' },
      terminal: {
        stop: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined)
      }
    } as unknown as typeof window.oxe
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('ThreadProjectTerminal keeps open terminal tabs mounted inside .thread-terminal-slot and terminalVisibility detects hidden slots', async () => {
    // 1. terminalVisibility detects and observes .thread-terminal-slot toggling.
    const slot = document.createElement('div')
    slot.className = 'thread-terminal-slot'
    const innerHost = document.createElement('div')
    slot.appendChild(innerHost)
    document.body.appendChild(slot)
    try {
      const changes: boolean[] = []
      const stop = observeTerminalVisibility(innerHost, (hidden) => changes.push(hidden))
      expect(isTerminalHostHidden(innerHost)).toBe(false)

      slot.style.display = 'none'
      slot.setAttribute('aria-hidden', 'true')
      await waitFor(() => expect(changes).toEqual([true]))
      expect(isTerminalHostHidden(innerHost)).toBe(true)

      slot.style.display = 'flex'
      slot.setAttribute('aria-hidden', 'false')
      await waitFor(() => expect(changes).toEqual([true, false]))
      expect(isTerminalHostHidden(innerHost)).toBe(false)
      stop()
    } finally {
      slot.remove()
    }

    // 2. ThreadProjectTerminal keeps tab 1 mounted (hidden) when opening/switching to tab 2 and switching back.
    const thread = {
      id: 'thread-oxe443',
      workspaceId: 'thread:proj-1',
      rootPath: 'C:/repo'
    } as unknown as ConversationThread

    render(<ThreadProjectTerminal thread={thread} />)
    const pane1Id = 'thread-shell:thread-oxe443:1'
    const pane2Id = 'thread-shell:thread-oxe443:2'

    expect(screen.getByTestId(`mock-pane-${pane1Id}`)).toBeTruthy()
    expect(mountCounts.get(pane1Id)).toBe(1)

    const addButton = screen.getByRole('button', { name: /new terminal|novo terminal/i })
    fireEvent.click(addButton)

    expect(screen.getByTestId(`mock-pane-${pane2Id}`)).toBeTruthy()
    expect(screen.getByTestId(`mock-pane-${pane1Id}`)).toBeTruthy()
    expect(unmountCounts.get(pane1Id) ?? 0).toBe(0)

    const slot1 = screen.getByTestId(`mock-pane-${pane1Id}`).closest('.thread-terminal-slot') as HTMLElement | null
    const slot2 = screen.getByTestId(`mock-pane-${pane2Id}`).closest('.thread-terminal-slot') as HTMLElement | null
    expect(slot1).not.toBeNull()
    expect(slot2).not.toBeNull()
    expect(isTerminalHostHidden(screen.getByTestId(`mock-pane-${pane1Id}`))).toBe(true)
    expect(isTerminalHostHidden(screen.getByTestId(`mock-pane-${pane2Id}`))).toBe(false)

    // Switch back to tab 1: tab 2 stays mounted and becomes hidden; tab 1 becomes visible without remounting.
    const tabButtons = screen.getAllByRole('button', { pressed: false })
    fireEvent.click(tabButtons[0])
    expect(isTerminalHostHidden(screen.getByTestId(`mock-pane-${pane1Id}`))).toBe(false)
    expect(isTerminalHostHidden(screen.getByTestId(`mock-pane-${pane2Id}`))).toBe(true)
    expect(mountCounts.get(pane1Id)).toBe(1)
    expect(unmountCounts.get(pane2Id) ?? 0).toBe(0)

    // Close tab 2 explicitly: only tab 2 unmounts; tab 1 stays mounted and visible.
    const closeButtons = document.querySelectorAll('.thread-shell-tab-close')
    expect(closeButtons.length).toBe(2)
    fireEvent.click(closeButtons[1])
    expect(unmountCounts.get(pane2Id)).toBe(1)
    expect(unmountCounts.get(pane1Id) ?? 0).toBe(0)
    expect(screen.getByTestId(`mock-pane-${pane1Id}`)).toBeTruthy()
  })

  test('App workspace surface visibility preserves maximizedPaneId and side panels across OxeCode and OxeChat view switches', () => {
    const common = {
      workspaceId: 'ws-a',
      activeWorkspaceId: 'ws-a',
      paneIds: ['p1', 'p2'],
      maximizedPaneId: 'p1',
      activePaneId: 'p1',
      isIntegrationPanelOpen: true,
      isSearchPanelOpen: true,
      containersOpen: true
    }

    const inCode = resolveWorkspaceSurfaceVisibility({ ...common, applicationView: 'code' })
    const inThread = resolveWorkspaceSurfaceVisibility({ ...common, applicationView: 'thread' })
    const backInCode = resolveWorkspaceSurfaceVisibility({ ...common, applicationView: 'code' })

    expect(inCode).toEqual({
      isSelectedWorkspace: true,
      isActive: true,
      maximizedPaneId: 'p1',
      integrationVisible: true,
      searchVisible: true,
      containersVisible: true,
      activePaneId: 'p1'
    })
    // Switching OxeCode -> OxeChat keeps maximizedPaneId and side panels intact for the selected workspace.
    expect(inThread).toEqual({
      isSelectedWorkspace: true,
      isActive: false,
      maximizedPaneId: 'p1',
      integrationVisible: true,
      searchVisible: true,
      containersVisible: true,
      activePaneId: null
    })
    expect(backInCode).toEqual(inCode)

    // Another mounted workspace does NOT receive ws-a's maximizedPaneId or global side panels.
    const otherWorkspace = resolveWorkspaceSurfaceVisibility({
      ...common,
      workspaceId: 'ws-b',
      paneIds: ['p3'],
      applicationView: 'code'
    })
    expect(otherWorkspace).toEqual({
      isSelectedWorkspace: false,
      isActive: false,
      maximizedPaneId: null,
      integrationVisible: false,
      searchVisible: false,
      containersVisible: false,
      activePaneId: null
    })

    // Verify App.tsx actually delegates workspace surface visibility to resolveWorkspaceSurfaceVisibility.
    const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(appSource).toContain('resolveWorkspaceSurfaceVisibility')
    expect(appSource).not.toContain('maximizedPaneId={isActive ? maximizedPaneId : null}')
    expect(appSource).not.toContain('integrationVisible={isActive && isIntegrationPanelOpen}')
  })
})
