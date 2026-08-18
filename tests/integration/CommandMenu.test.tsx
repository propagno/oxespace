import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../shared/types/workspace'
import { CommandMenu } from '../../src/components/CommandMenu/CommandMenu'

const workspace = createWorkspace()

class ResizeObserverStub {
  observe(): void { /* no-op for cmdk */ }
  unobserve(): void { /* no-op */ }
  disconnect(): void { /* no-op */ }
}

describe('CommandMenu', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    Element.prototype.scrollIntoView = vi.fn()
    window.oxe = {
      ...window.oxe,
      search: {
        listFiles: vi.fn().mockResolvedValue({ files: ['src/App.tsx', 'src/main.tsx'], truncated: false }),
        run: vi.fn().mockResolvedValue({
          files: [{ path: 'src/App.tsx', matches: [{ lineNumber: 10, lineText: 'export function App' }] }],
          totalMatches: 1,
          truncated: false
        })
      },
      semantic: {
        query: vi.fn().mockResolvedValue([])
      }
    } as never
  })

  test('lists actions and runs one when selected', async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <CommandMenu
        open
        onOpenChange={onOpenChange}
        workspace={workspace}
        actions={[{ id: 'open-tools', title: 'Open Tools', category: 'Workspace', run }]}
        workspaces={[workspace]}
        onSelectWorkspace={() => undefined}
        onSelectPane={() => undefined}
      />
    )

    await user.click(await screen.findByText('Open Tools'))
    expect(run).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('matches actions by multi-word tokens ("usage rate" → "Usage & Rate Limits")', async () => {
    const user = userEvent.setup()

    render(
      <CommandMenu
        open
        onOpenChange={vi.fn()}
        workspace={workspace}
        actions={[
          { id: 'open-usage', title: 'Usage & Rate Limits', category: 'AI & Agents', run: vi.fn() },
          { id: 'open-tools', title: 'Open Tools', category: 'Workspace', run: vi.fn() }
        ]}
        workspaces={[workspace]}
        onSelectWorkspace={() => undefined}
        onSelectPane={() => undefined}
      />
    )

    const input = await screen.findByPlaceholderText(/Search files and commands/i)
    await user.type(input, 'usage rate')

    await waitFor(() => expect(screen.getByText('Usage & Rate Limits')).toBeInTheDocument())
    expect(screen.queryByText('Open Tools')).not.toBeInTheDocument()
  })

  test('searches file names and opens the editor for a match', async () => {
    const user = userEvent.setup()
    const openFile = vi.fn().mockResolvedValue(undefined)
    const updateEditorState = vi.fn().mockResolvedValue(undefined)
    window.oxe = {
      ...window.oxe,
      search: {
        listFiles: vi.fn().mockResolvedValue({ files: ['src/App.tsx', 'README.md'], truncated: false }),
        run: vi.fn().mockResolvedValue({ files: [], totalMatches: 0, truncated: false })
      },
      semantic: { query: vi.fn().mockResolvedValue([]) },
      workspace: {
        ...(window.oxe as { workspace?: object }).workspace,
        updateEditorState
      },
      fs: {
        ...(window.oxe as { fs?: object }).fs,
        openFile
      }
    } as never

    // CommandMenu uses editor/workspace stores which call window.oxe APIs.
    const { useEditorStore } = await import('../../src/store/editor.store')
    const { useWorkspaceStore } = await import('../../src/store/workspace.store')
    useEditorStore.setState({
      openFile: vi.fn().mockResolvedValue(undefined)
    } as never)
    useWorkspaceStore.setState({
      updateEditorState: vi.fn().mockResolvedValue(undefined),
      workspaces: [workspace]
    } as never)

    render(
      <CommandMenu
        open
        onOpenChange={vi.fn()}
        workspace={workspace}
        actions={[]}
        workspaces={[workspace]}
        onSelectWorkspace={() => undefined}
        onSelectPane={() => undefined}
      />
    )

    const input = await screen.findByPlaceholderText(/Search files and commands/i)
    await user.type(input, 'App')

    await waitFor(() => expect(screen.getByText('App.tsx')).toBeInTheDocument())
    await user.click(screen.getByText('App.tsx'))
    await waitFor(() => expect(useEditorStore.getState().openFile).toHaveBeenCalled())
  })
})

function createWorkspace(): Workspace {
  return {
    id: 'workspace-1',
    name: 'repo',
    rootPath: 'C:/repo',
    layout: '1x1',
    layoutPreset: 1,
    themeId: 'midnight',
    uiDensity: 'compact',
    defaultShellProfileId: 'builtin-claude',
    autoStart: false,
    isActive: true,
    editorVisible: false,
    editorExpanded: false,
    editorWidthPercent: 40,
    reviewPanelVisible: false,
    reviewPanelExpanded: false,
    reviewPanelWidthPercent: 36,
    githubPanelVisible: false,
    githubPanelExpanded: false,
    githubPanelWidthPercent: 40,
    githubActiveTab: 'status',
    backgroundPanelVisible: false,
    backgroundPanelExpanded: false,
    backgroundPanelWidthPercent: 28,
    worktreePanelVisible: false,
    worktreePanelExpanded: false,
    worktreePanelWidthPercent: 36,
    panes: [
      {
        id: 'pane-1',
        workspaceId: 'workspace-1',
        type: 'terminal',
        rowIndex: 0,
        columnIndex: 0,
        shellProfileId: 'builtin-claude',
        status: 'idle',
        agentProfileId: null,
        agentName: null,
        displayName: 'Main',
        createdAt: null,
        modelOverride: null,
        rootPath: null
      }
    ]
  }
}
