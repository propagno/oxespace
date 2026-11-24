import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../shared/types/workspace'
import { CommandMenu } from '../../src/components/CommandMenu/CommandMenu'
import { clearFileListCache, LIST_FILES_CACHE_TTL_MS } from '../../src/components/CommandMenu/fileListCache'

const workspace = createWorkspace()

class ResizeObserverStub {
  observe(): void { /* no-op for cmdk */ }
  unobserve(): void { /* no-op */ }
  disconnect(): void { /* no-op */ }
}

describe('CommandMenu', () => {
  beforeEach(() => {
    clearFileListCache()
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

  test('ranks the best match first and shows shortcuts as key caps', async () => {
    const user = userEvent.setup()
    render(
      <CommandMenu open onOpenChange={vi.fn()} workspace={workspace} workspaces={[]} onSelectWorkspace={() => undefined} onSelectPane={() => undefined}
        actions={[
          { id: 'find', title: 'Find in files', category: 'Development', shortcut: 'code.search', run: vi.fn() },
          { id: 'files', title: 'Files', category: 'System', shortcut: 'Mod+E', run: vi.fn() }
        ]} />
    )
    await user.type(await screen.findByPlaceholderText(/Search files and commands/i), 'fi')
    await waitFor(() => expect(screen.getByText('Files')).toBeInTheDocument())
    const titles = screen.getAllByRole('option').map(option => option.textContent ?? '')
    expect(titles.findIndex(text => text.startsWith('Files'))).toBeLessThan(titles.findIndex(text => text.startsWith('Find in files')))
    expect(screen.getByLabelText('Ctrl+Shift+F')).toBeInTheDocument()
    expect(screen.getByLabelText('Ctrl+E')).toBeInTheDocument()
  })

  test('lists the last commands run under Recent when the query is empty', async () => {
    const user = userEvent.setup()
    const { useCommandHistoryStore } = await import('../../src/store/command-history.store')
    useCommandHistoryStore.setState({ recent: [] })
    const actions = [
      { id: 'open-usage', title: 'Usage & Rate Limits', category: 'AI & Agents', run: vi.fn() },
      { id: 'open-tools', title: 'Open Tools', category: 'Workspace', run: vi.fn() }
    ]
    const view = render(<CommandMenu open onOpenChange={vi.fn()} workspace={workspace} actions={actions} workspaces={[]} onSelectWorkspace={() => undefined} onSelectPane={() => undefined} />)
    expect(screen.queryByText('Recent')).not.toBeInTheDocument()
    await user.click(await screen.findByText('Open Tools'))
    expect(useCommandHistoryStore.getState().recent).toEqual(['open-tools'])
    view.rerender(<CommandMenu open={false} onOpenChange={vi.fn()} workspace={workspace} actions={actions} workspaces={[]} onSelectWorkspace={() => undefined} onSelectPane={() => undefined} />)
    view.rerender(<CommandMenu open onOpenChange={vi.fn()} workspace={workspace} actions={actions} workspaces={[]} onSelectWorkspace={() => undefined} onSelectPane={() => undefined} />)
    const recent = await screen.findByText('Recent')
    expect(recent.closest('[cmdk-group]')?.textContent).toContain('Open Tools')
    for (let index = 0; index < 12; index++) useCommandHistoryStore.getState().record(`command-${index}`)
    expect(useCommandHistoryStore.getState().recent).toHaveLength(8)
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

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('reuses cached file list within 30s TTL across consecutive reopens of the same rootPath without re-invoking listFiles', async () => {
    const user = userEvent.setup()
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    const listFiles = vi.fn().mockResolvedValue({ files: ['src/App.tsx', 'src/main.tsx'], truncated: false })
    window.oxe = {
      ...window.oxe,
      search: {
        listFiles,
        run: vi.fn().mockResolvedValue({ files: [], totalMatches: 0, truncated: false })
      },
      semantic: { query: vi.fn().mockResolvedValue([]) }
    } as never

    const view = render(
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

    await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(1))
    const input = await screen.findByPlaceholderText(/Search files and commands/i)
    await user.type(input, 'App')
    await waitFor(() => expect(screen.getByText('App.tsx')).toBeInTheDocument())

    // Close and reopen twice within the 30s TTL: zero additional IPC calls.
    now += 10_000
    view.rerender(
      <CommandMenu
        open={false}
        onOpenChange={vi.fn()}
        workspace={workspace}
        actions={[]}
        workspaces={[workspace]}
        onSelectWorkspace={() => undefined}
        onSelectPane={() => undefined}
      />
    )
    view.rerender(
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

    const reopenedInput = await screen.findByPlaceholderText(/Search files and commands/i)
    await user.type(reopenedInput, 'main')
    expect(screen.getByText('main.tsx')).toBeInTheDocument()
    expect(listFiles).toHaveBeenCalledTimes(1)

    now += LIST_FILES_CACHE_TTL_MS - 10_001
    view.rerender(
      <CommandMenu
        open={false}
        onOpenChange={vi.fn()}
        workspace={workspace}
        actions={[]}
        workspaces={[workspace]}
        onSelectWorkspace={() => undefined}
        onSelectPane={() => undefined}
      />
    )
    view.rerender(
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

    const thirdInput = await screen.findByPlaceholderText(/Search files and commands/i)
    await user.type(thirdInput, 'App')
    expect(screen.getByText('App.tsx')).toBeInTheDocument()
    expect(listFiles).toHaveBeenCalledTimes(1)
  })

  test('revalidates file list in background after 30s TTL and isolates cache entries per rootPath', async () => {
    const user = userEvent.setup()
    let now = 2_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    const workspaceA = createWorkspace({ id: 'workspace-a', name: 'repo-a', rootPath: 'C:/repo-a' })
    const workspaceB = createWorkspace({ id: 'workspace-b', name: 'repo-b', rootPath: 'C:/repo-b' })

    let resolveRevalidate!: (value: { files: string[]; truncated: boolean }) => void
    let resolveWorkspaceB!: (value: { files: string[]; truncated: boolean }) => void
    const listFiles = vi
      .fn()
      .mockResolvedValueOnce({ files: ['src/alpha.ts'], truncated: false })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRevalidate = resolve }))
      .mockRejectedValueOnce(new Error('rg failed'))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveWorkspaceB = resolve }))

    window.oxe = {
      ...window.oxe,
      search: {
        listFiles,
        run: vi.fn().mockResolvedValue({ files: [], totalMatches: 0, truncated: false })
      },
      semantic: { query: vi.fn().mockResolvedValue([]) }
    } as never

    const view = render(
      <CommandMenu
        open
        onOpenChange={vi.fn()}
        workspace={workspaceA}
        actions={[]}
        workspaces={[workspaceA, workspaceB]}
        onSelectWorkspace={() => undefined}
        onSelectPane={() => undefined}
      />
    )

    await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(1))
    await user.type(await screen.findByPlaceholderText(/Search files and commands/i), 'alpha')
    await waitFor(() => expect(screen.getByText('alpha.ts')).toBeInTheDocument())

    // Expire TTL (> 30s) and reopen: stale list renders immediately while 1 background revalidation runs.
    now += LIST_FILES_CACHE_TTL_MS + 1
    view.rerender(
      <CommandMenu
        open={false}
        onOpenChange={vi.fn()}
        workspace={workspaceA}
        actions={[]}
        workspaces={[workspaceA, workspaceB]}
        onSelectWorkspace={() => undefined}
        onSelectPane={() => undefined}
      />
    )
    view.rerender(
      <CommandMenu
        open
        onOpenChange={vi.fn()}
        workspace={workspaceA}
        actions={[]}
        workspaces={[workspaceA, workspaceB]}
        onSelectWorkspace={() => undefined}
        onSelectPane={() => undefined}
      />
    )

    expect(listFiles).toHaveBeenCalledTimes(2)
    const staleInput = await screen.findByPlaceholderText(/Search files and commands/i)
    await user.type(staleInput, 'alpha')
    expect(screen.getByText('alpha.ts')).toBeInTheDocument()

    // Background revalidation resolves and updates the displayed list.
    await act(async () => {
      resolveRevalidate({ files: ['src/alpha.ts', 'src/beta.ts'], truncated: false })
    })
    await user.clear(staleInput)
    await user.type(staleInput, 'beta')
    await waitFor(() => expect(screen.getByText('beta.ts')).toBeInTheDocument())

    // Failed background revalidation preserves the existing valid cache (RT-2).
    now += LIST_FILES_CACHE_TTL_MS + 1
    view.rerender(
      <CommandMenu
        open={false}
        onOpenChange={vi.fn()}
        workspace={workspaceA}
        actions={[]}
        workspaces={[workspaceA, workspaceB]}
        onSelectWorkspace={() => undefined}
        onSelectPane={() => undefined}
      />
    )
    view.rerender(
      <CommandMenu
        open
        onOpenChange={vi.fn()}
        workspace={workspaceA}
        actions={[]}
        workspaces={[workspaceA, workspaceB]}
        onSelectWorkspace={() => undefined}
        onSelectPane={() => undefined}
      />
    )

    await waitFor(() => expect(listFiles).toHaveBeenCalledTimes(3))
    const retryInput = await screen.findByPlaceholderText(/Search files and commands/i)
    await user.type(retryInput, 'beta')
    expect(screen.getByText('beta.ts')).toBeInTheDocument()

    // Switching to another rootPath clears workspaceA's list immediately and isolates cache entries.
    view.rerender(
      <CommandMenu
        open={false}
        onOpenChange={vi.fn()}
        workspace={workspaceB}
        actions={[]}
        workspaces={[workspaceA, workspaceB]}
        onSelectWorkspace={() => undefined}
        onSelectPane={() => undefined}
      />
    )
    view.rerender(
      <CommandMenu
        open
        onOpenChange={vi.fn()}
        workspace={workspaceB}
        actions={[]}
        workspaces={[workspaceA, workspaceB]}
        onSelectWorkspace={() => undefined}
        onSelectPane={() => undefined}
      />
    )

    expect(listFiles).toHaveBeenCalledTimes(4)
    expect(listFiles).toHaveBeenLastCalledWith({ workspaceId: 'workspace-b', rootPath: 'C:/repo-b' })
    const wsBInput = await screen.findByPlaceholderText(/Search files and commands/i)
    await user.type(wsBInput, 'beta')
    expect(screen.queryByText('beta.ts')).not.toBeInTheDocument()

    await act(async () => {
      resolveWorkspaceB({ files: ['src/gamma.ts'], truncated: false })
    })
    await user.clear(wsBInput)
    await user.type(wsBInput, 'gamma')
    await waitFor(() => expect(screen.getByText('gamma.ts')).toBeInTheDocument())
    expect(screen.queryByText('beta.ts')).not.toBeInTheDocument()
  })
})

function createWorkspace(overrides: Partial<Workspace> = {}): Workspace {
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
    ],
    ...overrides
  }
}

// OXE-300: opening the menu again starts from an empty query with no results, reset on the open transition itself,
// not by an effect that sets state after the render (react-hooks/set-state-in-effect); the current root's file list
// still answers a name search (OXE-41).
describe('OXE-300 CommandMenu reopen', () => {
  beforeEach(() => {
    clearFileListCache()
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
      semantic: { query: vi.fn().mockResolvedValue([]) }
    } as never
  })

  test('reopening CommandMenu resets query and results cleanly without extra effect-driven state reset', async () => {
    const user = userEvent.setup()
    const menu = (open: boolean) => (
      <CommandMenu open={open} onOpenChange={vi.fn()} workspace={workspace} actions={[]} workspaces={[workspace]}
        onSelectWorkspace={() => undefined} onSelectPane={() => undefined} />
    )
    const view = render(menu(true))
    await user.type(await screen.findByPlaceholderText(/Search files and commands/i), 'export')
    await waitFor(() => expect(screen.getByText('src/App.tsx')).toBeInTheDocument())

    view.rerender(menu(false))
    view.rerender(menu(true))
    const input = await screen.findByPlaceholderText(/Search files and commands/i)
    expect(input).toHaveValue('')
    expect(screen.queryByText('src/App.tsx'), 'no result of the earlier query').toBeNull()

    await user.type(input, 'main')
    await waitFor(() => expect(screen.getByText('main.tsx')).toBeInTheDocument())

    const source = readFileSync(join(process.cwd(), 'src/components/CommandMenu/CommandMenu.tsx'), 'utf8')
    const effects = [...source.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[/g)].map(match => match[1])
    expect(effects.length).toBeGreaterThan(0)
    for (const body of effects) expect(body, 'no state set synchronously at the top of an effect').not.toMatch(/^ {4}(?:if \(.*\) \{\r?\n {6})?set[A-Z]\w*\(/m)
  })
})
