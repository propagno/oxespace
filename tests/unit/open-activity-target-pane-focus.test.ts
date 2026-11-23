import { beforeEach, describe, expect, test, vi } from 'vitest'
import { openActivityTarget } from '../../src/components/Activity/openActivityTarget'
import { useTerminalStore } from '../../src/store/terminal.store'
import { useUIStore } from '../../src/store/ui.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'

/**
 * OXE-364: the homologation scene for Ctrl+Shift+U (OXE-128), once it asserted its target, showed the waiting pane
 * never became the focused one. The grid draws the focused pane from the UI store (App's activePaneId); going to a
 * pane set only the terminal store's. A pane target now sets both, as a click on the pane does.
 */
describe('OXE-364 · going to a pane that needs the person focuses it', () => {
  beforeEach(() => {
    useUIStore.setState({ activePaneId: 'p1' })
    useTerminalStore.setState({ panes: {}, activePaneId: 'p1' })
    useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1' } as never)
  })

  test('the pane the next stop names becomes the focused pane of the grid', () => {
    const selectView = vi.fn()
    openActivityTarget({ type: 'pane', workspaceId: 'ws-1', paneId: 'p4' }, selectView)
    expect(selectView).toHaveBeenCalledWith('code')
    expect(useUIStore.getState().activePaneId, 'the grid draws this pane as focused').toBe('p4')
    expect(useTerminalStore.getState().activePaneId).toBe('p4')
  })
})
