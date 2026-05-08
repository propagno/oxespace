import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkspacePane } from '../../shared/types/workspace'
import { PaneContent } from '../../src/components/Panes/PaneContent'

vi.mock('../../src/components/Panes/TerminalPane', () => ({
  TerminalPane: () => <div data-testid="terminal-pane">Terminal</div>
}))

vi.mock('../../src/components/Editor/EditorPane', () => ({
  EditorPane: () => <div data-testid="editor-pane">EditorPane</div>
}))

describe('PaneContent', () => {
  beforeEach(() => {
    window.oxe = {
      app: { version: '0.1.0' },
      workspace: {
        list: vi.fn(),
        create: vi.fn(),
        setActive: vi.fn(),
        delete: vi.fn(),
        closePane: vi.fn(),
        splitPane: vi.fn(),
        updatePaneType: vi.fn(),
        pickFolder: vi.fn(),
        shellProfiles: vi.fn()
      },
      terminal: {
        start: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        stop: vi.fn(),
        restart: vi.fn(),
        onData: vi.fn(() => vi.fn()),
        onExit: vi.fn(() => vi.fn())
      }
    }
    global.ResizeObserver = class {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    }
  })

  test('renders terminal panes and future pane stubs', () => {
    render(<PaneContent pane={createPane('terminal')} workspaceId="workspace-1" autoStart={false} />)
    expect(screen.getByTestId('terminal-pane')).toHaveTextContent('Terminal')

    render(<PaneContent pane={createPane('editor')} workspaceId="workspace-1" autoStart={false} />)
    expect(screen.getByTestId('editor-pane')).toHaveTextContent('EditorPane')
  })
})

function createPane(type: WorkspacePane['type']): WorkspacePane {
  return {
    id: `pane-${type}`,
    workspaceId: 'workspace-1',
    type,
    rowIndex: 0,
    columnIndex: 0,
    shellProfileId: 'builtin-claude',
    status: 'idle'
  }
}
