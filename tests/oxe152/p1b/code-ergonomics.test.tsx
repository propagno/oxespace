// Frozen acceptance test for OXE-339 A1, A2 (program 152p1b, phase F1). Written by the planner; the executor must not edit it.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiffComment } from '../../../shared/types/diff-comments'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { changeLanguage } from '../../../src/i18n'
import { CommandMenu } from '../../../src/components/CommandMenu/CommandMenu'
import { clearFileListCache } from '../../../src/components/CommandMenu/fileListCache'
import { ChangesPanel } from '../../../src/components/Changes/ChangesPanel'
import { useDiffCommentsStore } from '../../../src/store/diff-comments.store'
import { useEditorStore } from '../../../src/store/editor.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { preloadOxe } from '../../acceptance/f4/crf4-8-preload'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null }) }))
vi.mock('../../../src/components/Panes/PaneContent', () => ({ PaneContent: () => null }))
vi.mock('../../../src/components/Panes/PaneBranchBadge', () => ({ PaneBranchBadge: () => null }))
const { PaneContainer } = await import('../../../src/components/Grid/PaneContainer')

const pane = { id: 'p1', workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: null, agentName: 'Claude', displayName: 'Builder', shellProfileId: null, rootPath: null, createdAt: null } as WorkspacePane
const workspace = { id: 'ws-1', name: 'demo', rootPath: '/repo', defaultShellProfileId: null, panes: [pane], shellProfiles: [] } as unknown as Workspace
const original = window.oxe
const openFile = useEditorStore.getState().openFile

beforeEach(async () => {
  await changeLanguage('en')
  clearFileListCache()
  vi.stubGlobal('ResizeObserver', class { observe() { /* none */ } unobserve() { /* none */ } disconnect() { /* none */ } })
  Element.prototype.scrollIntoView = vi.fn()
  useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: 'ws-1', shellProfiles: [] })
})
afterEach(() => {
  cleanup()
  useEditorStore.setState({ openFile })
  useDiffCommentsStore.setState({ comments: [] })
  vi.unstubAllGlobals()
  window.oxe = original
})

describe('OXE-339 · OxeCode', () => {
  it('a content match shows its line and opens on it', async () => {
    const open = vi.fn(async () => undefined)
    useEditorStore.setState({ openFile: open })
    window.oxe = {
      ...original,
      search: {
        listFiles: async () => ({ files: [], truncated: false }),
        run: async () => ({ files: [{ path: 'src/App.tsx', truncated: false, matches: [{ lineNumber: 42, line: 'export function needleHandler() {', submatches: [] }] }], totalMatches: 1, totalFiles: 1, truncated: false, elapsedMs: 1 })
      },
      semantic: { query: async () => [] },
      workspace: { updateEditorState: async () => workspace }
    } as unknown as typeof window.oxe
    const user = userEvent.setup()
    render(<CommandMenu open onOpenChange={vi.fn()} workspace={workspace} actions={[]} workspaces={[]} onSelectWorkspace={() => undefined} onSelectPane={() => undefined} />)
    await user.type(await screen.findByPlaceholderText(/Search files and commands/i), 'needle')
    const snippet = await screen.findByText(/export function needleHandler/, {}, { timeout: 4_000 })
    await user.click(snippet)
    expect(open).toHaveBeenCalledWith({ workspaceId: 'ws-1', rootPath: '/repo', relativePath: 'src/App.tsx', line: 42 })
  }, 15_000)

  it('discarding review comments asks or can be undone', async () => {
    preloadOxe({
      'git.getBranch': () => ({ branch: 'main', shortSha: null }),
      'git.getDiffSummary': () => ({ files: [], additions: 0, deletions: 0, compiledAt: 1 }),
      'github.listBranches': () => [],
      'github.listWorktrees': () => [],
      'github.resolveWorktreeBase': () => ({ baseRef: 'main' })
    })
    const comment = { id: 'c1', workspaceId: 'ws-1', filePath: 'src/a.ts', side: 'new', lineNo: 3, lineContent: 'const a = 1', body: 'rename this', createdAt: 1 } as DiffComment
    useDiffCommentsStore.setState({ comments: [comment] })
    const { Toaster } = await import('../../../src/ui/Toast')
    render(<><ChangesPanel workspaceId="ws-1" rootPath="/repo" /><Toaster /></>)
    fireEvent.click(await screen.findByRole('button', { name: /^Discard/ }))
    await waitFor(() => {
      const asks = screen.queryByRole('dialog') ?? screen.queryByRole('alertdialog')
      expect(asks ?? screen.queryByRole('button', { name: 'Undo' })).not.toBeNull()
    })
    const asks = screen.queryByRole('dialog') ?? screen.queryByRole('alertdialog')
    if (asks) fireEvent.click(within(asks).getByRole('button', { name: 'Cancel' }))
    else fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(useDiffCommentsStore.getState().comments).toEqual([comment]))
  }, 15_000)

  it('a pane is renamed from its menu', async () => {
    render(<PaneContainer pane={pane} workspace={workspace} agentProfile={null} autoStart={false} isMaximized={false} onToggleMaximize={() => undefined} />)
    fireEvent.click(document.querySelector('button[aria-haspopup="menu"].tile-btn') as HTMLElement)
    fireEvent.click(await screen.findByRole('menuitem', { name: /Rename/ }))
    await waitFor(() => expect(document.querySelector('input.pane-intent-input')).not.toBeNull())
  })

  it('a pane title is renamed with Enter and with F2', async () => {
    for (const key of ['Enter', 'F2']) {
      const view = render(<PaneContainer pane={pane} workspace={workspace} agentProfile={null} autoStart={false} isMaximized={false} onToggleMaximize={() => undefined} />)
      const title = view.container.querySelector('button.pane-intent-button') as HTMLElement
      title.focus()
      await userEvent.keyboard(`{${key}}`)
      await waitFor(() => expect(view.container.querySelector('input.pane-intent-input'), key).not.toBeNull())
      view.unmount()
    }
  })
})
