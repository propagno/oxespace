// Frozen acceptance test for 1.5.2 OxeCode A2 (OXE program oxespace-152-code, phase F1, CODE-8 from the 12/11 backlog).
// Written by the planner; the executor must not edit it. It renders the real PaneContainer over the real preload
// (tests/acceptance/f4/crf4-8-preload.ts, read only).
// Contract: a `contextmenu` event (right click, Shift+F10, the context-menu key) on the pane header opens the same actions
// menu as the ⋯ button ([data-testid="pane-actions-menu"], role="menu"), placed at the pointer, not at the ⋯ button.
// Escape closes it. A right click inside the rename field keeps the field's own menu.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'
import { useTerminalStore } from '../../../src/store/terminal.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { preloadOxe } from '../../acceptance/f4/crf4-8-preload'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null }) }))
vi.mock('../../../src/components/Panes/PaneContent', () => ({ PaneContent: () => null }))

const pane = { id: 'p1', workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: null, agentName: null, displayName: null, shellProfileId: null, rootPath: null, createdAt: null } as unknown as WorkspacePane
const workspace = { id: 'ws-1', name: 'demo', rootPath: '/repo', defaultShellProfileId: null, panes: [pane] } as unknown as Workspace

async function mount(): Promise<HTMLElement> {
  preloadOxe({ 'terminal.branch': () => ({ branch: 'main', startedOn: 'main', switched: false }) })
  useTerminalStore.setState({ panes: {}, activePaneId: null })
  useWorkspaceStore.setState({ workspaces: [workspace], shellProfiles: [] })
  const { PaneContainer } = await import('../../../src/components/Grid/PaneContainer')
  const { container } = render(<PaneContainer pane={pane} workspace={workspace} agentProfile={null} autoStart={false} isMaximized={false} onToggleMaximize={() => undefined} />)
  const header = container.querySelector('header.pane-header') as HTMLElement
  expect(header).not.toBeNull()
  return header
}

beforeEach(async () => { await changeLanguage('en') })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('A2 · the pane header opens its actions on a right click (CODE-8)', () => {
  test('a contextmenu on the header opens the pane actions menu with the ⋯ items', async () => {
    const header = await mount()
    expect(screen.queryByTestId('pane-actions-menu')).toBeNull()
    await act(async () => { fireEvent.contextMenu(header, { clientX: 320, clientY: 140 }) })
    const menu = await screen.findByTestId('pane-actions-menu')
    expect(menu).toHaveAttribute('role', 'menu')
    expect(within(menu).getByRole('menuitem', { name: /Details/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /Why this status\?/ })).toBeInTheDocument()
  }, 30_000)

  test('the event is taken: the browser menu does not open over it', async () => {
    const header = await mount()
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 320, clientY: 140 })
    await act(async () => { header.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
  }, 30_000)

  test('the menu opens at the pointer, not at the ⋯ button', async () => {
    const header = await mount()
    await act(async () => { fireEvent.contextMenu(header, { clientX: 320, clientY: 140 }) })
    const menu = await screen.findByTestId('pane-actions-menu')
    const left = parseFloat(menu.style.left)
    const top = parseFloat(menu.style.top)
    expect(Number.isFinite(left) && Number.isFinite(top)).toBe(true)
    expect(Math.abs(left - 320)).toBeLessThanOrEqual(8)
    expect(Math.abs(top - 140)).toBeLessThanOrEqual(8)
  }, 30_000)

  test('Escape closes it', async () => {
    const header = await mount()
    await act(async () => { fireEvent.contextMenu(header, { clientX: 320, clientY: 140 }) })
    await screen.findByTestId('pane-actions-menu')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('pane-actions-menu')).toBeNull())
  }, 30_000)

  test('the ⋯ button still opens the same menu', async () => {
    await mount()
    await userEvent.click(screen.getByRole('button', { name: 'More pane actions' }))
    expect(await screen.findByTestId('pane-actions-menu')).toBeInTheDocument()
  }, 30_000)
})
