import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkspacePane } from '../../shared/types/workspace'
import { TerminalPane } from '../../src/components/Panes/TerminalPane'
import { useTerminalStore } from '../../src/store/terminal.store'

vi.mock('../../src/components/Terminal/TerminalView', () => ({
  TerminalView: ({ onInput, onResize }: { onInput: (data: string) => void; onResize: (cols: number, rows: number) => void }) => (
    <div data-testid="terminal-view">
      <button type="button" onClick={() => onInput('a')}>
        input
      </button>
      <button type="button" onClick={() => onResize(120, 32)}>
        resize
      </button>
    </div>
  )
}))

describe('TerminalPane', () => {
  beforeEach(() => {
    useTerminalStore.setState({ panes: {} })
    window.oxe = {
      app: { version: '0.1.0' },
      workspace: {
        list: vi.fn(),
        create: vi.fn(),
        setActive: vi.fn(),
        delete: vi.fn(),
        closePane: vi.fn(),
        pickFolder: vi.fn(),
        shellProfiles: vi.fn()
      },
      terminal: {
        start: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined),
        resize: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        restart: vi.fn().mockResolvedValue(undefined),
        onData: vi.fn(() => vi.fn()),
        onExit: vi.fn(() => vi.fn())
      }
    }
  })

  test('starts, writes, resizes and stops a terminal', async () => {
    const user = userEvent.setup()
    render(<TerminalPane pane={createPane()} workspaceId="workspace-1" autoStart={false} />)

    await user.click(screen.getByLabelText('Start terminal'))
    await waitFor(() => expect(window.oxe.terminal.start).toHaveBeenCalledWith({ paneId: 'pane-1', workspaceId: 'workspace-1' }))

    await user.click(screen.getByText('input'))
    await user.click(screen.getByText('resize'))

    expect(window.oxe.terminal.write).toHaveBeenCalledWith({ paneId: 'pane-1', data: 'a' })
    expect(window.oxe.terminal.resize).toHaveBeenCalledWith({ paneId: 'pane-1', cols: 120, rows: 32 })

    await user.click(screen.getByLabelText('Stop terminal'))
    expect(window.oxe.terminal.stop).toHaveBeenCalledWith({ paneId: 'pane-1' })
  })
})

function createPane(): WorkspacePane {
  return {
    id: 'pane-1',
    workspaceId: 'workspace-1',
    type: 'terminal',
    rowIndex: 0,
    columnIndex: 0,
    shellProfileId: 'builtin-claude',
    status: 'idle'
  }
}
