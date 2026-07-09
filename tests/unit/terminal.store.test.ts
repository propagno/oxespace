import { beforeEach, describe, expect, test } from 'vitest'
import { useTerminalStore } from '../../src/store/terminal.store'

describe('terminal store cleanup', () => {
  beforeEach(() => {
    useTerminalStore.setState({ panes: {}, pendingCommands: {}, activePaneId: null })
  })

  test('removes pane state, pending commands, and active focus when a terminal is released', () => {
    const store = useTerminalStore.getState()
    store.setStatus('pane-1', 'running')
    store.setPendingCommand('pane-1', 'grok')
    store.setActivePaneId('pane-1')

    useTerminalStore.getState().removePane('pane-1')

    const state = useTerminalStore.getState()
    expect(state.panes['pane-1']).toBeUndefined()
    expect(state.pendingCommands['pane-1']).toBeUndefined()
    expect(state.activePaneId).toBeNull()
  })
})
