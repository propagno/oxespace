import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadProvider, ThreadSideEvent, ThreadSideOpenOptions, ThreadSideOpenResult, ThreadSnapshot } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import { ThreadSideChat } from '../../../src/components/Threads/side/ThreadSideChat'
import { resetSideChats, showSideChat, terminalSideKey, useSideChatStore } from '../../../src/components/Threads/side/sideChatStore'
import { ThreadView } from '../../../src/components/Threads/ThreadView'
import { WorkspaceSurface } from '../../../src/components/Workspace/WorkspaceSurface'
import { changeLanguage } from '../../../src/i18n'
import { dispatchKeybinding, setKeyboardView } from '../../../src/keyboard/keybindings'
import { useAgentStore } from '../../../src/store/agent.store'
import { useThreadStore } from '../../../src/store/thread.store'

vi.mock('../../../src/components/Grid/WorkspaceGrid', () => ({
  WorkspaceGrid: ({ workspace }: { workspace: Workspace }) => <div data-testid="mock-workspace-grid">{workspace.id}</div>
}))
vi.mock('../../../src/components/Grid/WorkspaceSplitGrid', () => ({
  WorkspaceSplitGrid: ({ workspace }: { workspace: Workspace }) => <div data-testid="mock-workspace-split-grid">{workspace.id}</div>
}))
vi.mock('../../../src/components/Workspace/WorkspaceMissingRoot', () => ({
  useWorkspaceRootAvailable: () => true,
  WorkspaceMissingRoot: () => null
}))

function makeSnapshot(provider: ThreadProvider = 'antigravity', id = 'thread-466'): ThreadSnapshot {
  return {
    thread: {
      id,
      workspaceId: 'thread:proj-1',
      projectId: 'proj-1',
      rootPath: '/repo',
      provider,
      nativeSessionId: 'native-466',
      title: 'OXE-466 test conversation',
      pinned: false,
      status: 'idle',
      generation: 1,
      createdAt: 1,
      updatedAt: 2
    },
    events: [
      { type: 'message', id: 'm1', role: 'user', text: 'Why did the build break?' },
      { type: 'message', id: 'm2', role: 'assistant', text: 'A missing export in src/index.ts.' }
    ]
  }
}

function makeWorkspace(): Workspace {
  return {
    id: 'ws-code-466',
    name: 'OXESpace',
    rootPath: '/repo',
    layout: 1,
    autoStart: false,
    panes: [
      {
        id: 'pane-466',
        workspaceId: 'ws-code-466',
        type: 'terminal',
        rowIndex: 0,
        columnIndex: 0,
        displayName: 'Agent Shell',
        agentProfileId: 'prof-agy',
        status: 'running'
      }
    ]
  } as unknown as Workspace
}

describe('OXE-466 · agnostic multi-provider & cross-provider Side Chat UI', () => {
  let listener: ((event: ThreadSideEvent) => void) | undefined
  let sideCounter = 0
  let sideOpen: ReturnType<typeof vi.fn<(id: string, options?: ThreadSideOpenOptions) => Promise<ThreadSideOpenResult>>>
  let sideSend: ReturnType<typeof vi.fn<(sideId: string, text: string) => Promise<void>>>
  let sideClose: ReturnType<typeof vi.fn<(sideId: string) => Promise<void>>>
  let mainSend: ReturnType<typeof vi.fn>
  let mainSendTyped: ReturnType<typeof vi.fn>

  const emitSide = (sideId: string, event: ThreadSideEvent['event']): void => {
    act(() => { listener?.({ sideId, event }) })
  }

  beforeEach(async () => {
    await changeLanguage('en')
    resetSideChats()
    setKeyboardView('thread')
    sideCounter = 0
    sideOpen = vi.fn(async (id: string, options?: ThreadSideOpenOptions): Promise<ThreadSideOpenResult> => {
      sideCounter += 1
      const provider: ThreadProvider = options?.provider ?? 'claude'
      return {
        ok: true,
        side: {
          sideId: `side-${sideCounter}`,
          threadId: id,
          provider,
          readOnly: true,
          mode: options?.source === 'terminal' ? 'terminal-context' : provider === 'antigravity' ? 'ephemeral-context' : 'native-fork',
          source: options?.source ?? 'thread'
        }
      }
    })
    sideSend = vi.fn(async () => undefined)
    sideClose = vi.fn(async () => undefined)
    mainSend = vi.fn(async () => undefined)
    mainSendTyped = vi.fn(async () => undefined)

    useAgentStore.setState({
      allProfiles: [
        { agentProfileId: 'prof-claude', name: 'Claude', provider: 'claude', command: 'claude', commandTemplate: '', isBuiltin: true },
        { agentProfileId: 'prof-codex', name: 'Codex', provider: 'codex', command: 'codex', commandTemplate: '', isBuiltin: true },
        { agentProfileId: 'prof-agy', name: 'Antigravity', provider: 'antigravity', command: 'agy', commandTemplate: '', isBuiltin: true }
      ]
    })

    window.oxe = {
      ...(window.oxe ?? {}),
      app: { platform: 'win32', version: '1.6.0' },
      git: {
        getBranch: vi.fn(async () => ({ branch: 'feat/oxe-466', detached: false })),
        status: vi.fn(async () => ({ branch: 'feat/oxe-466', files: [] })),
        onBranch: vi.fn(() => () => {})
      },
      github: { getPullRequestStatus: vi.fn(async () => null) },
      thread: {
        ...(window.oxe?.thread ?? {}),
        sideOpen,
        sideSend,
        sideClose,
        onSideEvent: (cb: (event: ThreadSideEvent) => void) => { listener = cb; return () => { listener = undefined } },
        commands: vi.fn(async () => ({ commands: [] })),
        send: mainSend,
        sendTyped: mainSendTyped,
        steer: vi.fn(async () => undefined),
        steerTyped: vi.fn(async () => undefined),
        read: vi.fn(async () => makeSnapshot()),
        list: vi.fn(async () => []),
        projects: vi.fn(async () => ({ projects: [], unavailable: [] })),
        toolTabs: vi.fn(async () => []),
        onToolTabsChanged: vi.fn(() => () => {}),
        places: vi.fn(async () => ({ places: [] })),
        onPlacesChanged: vi.fn(() => () => {}),
        collisions: vi.fn(async () => [])
      }
    } as unknown as typeof window.oxe
  })

  afterEach(async () => {
    cleanup()
    resetSideChats()
    useThreadStore.setState({ selectedId: null, snapshot: null, snapshotCache: {}, drafts: {}, threads: [] })
    await changeLanguage('en')
  })

  it('switches providers inside the ThreadSideChat header, discards the old copy, renders quiet inline code, and translates EN + pt-BR', async () => {
    const onClose = vi.fn()
    render(<ThreadSideChat threadId="t-cross" defaultProvider="antigravity" onClose={onClose} onLeave={vi.fn()} />)

    await waitFor(() => expect(screen.getByTestId('thread-side-chat-input')).not.toBeDisabled())
    expect(screen.getByTestId('thread-side-chat')).toHaveAttribute('data-side-id', 'side-1')

    // Switch provider from default to Antigravity -> discards side-1 and opens side-2 with provider 'antigravity'.
    fireEvent.pointerDown(screen.getByTestId('thread-side-chat-provider'), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Antigravity' }))

    await waitFor(() => expect(sideClose).toHaveBeenCalledWith('side-1'))
    await waitFor(() => expect(sideOpen).toHaveBeenCalledWith('t-cross', { provider: 'antigravity' }))
    await waitFor(() => expect(screen.getByTestId('thread-side-chat')).toHaveAttribute('data-side-id', 'side-2'))
    expect(screen.getByTestId('thread-side-chat')).toHaveAttribute('data-side-provider', 'antigravity')

    // Switch cross-provider to Codex -> shows cross-provider read-only note and renders inline code quietly.
    fireEvent.pointerDown(screen.getByTestId('thread-side-chat-provider'), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Codex' }))
    await waitFor(() => expect(sideClose).toHaveBeenCalledWith('side-2'))
    await waitFor(() => expect(sideOpen).toHaveBeenCalledWith('t-cross', { provider: 'codex' }))
    await waitFor(() => expect(screen.getByTestId('thread-side-chat')).toHaveAttribute('data-side-id', 'side-3'))
    expect(screen.getByTestId('thread-side-chat')).toHaveTextContent('Answering with Codex from a read-only summary of this conversation.')

    emitSide('side-3', { type: 'message', id: 'a1', role: 'assistant', text: 'Check `src/auth.ts` first.' })
    const codeEl = screen.getByTestId('thread-side-chat-log').querySelector('code')
    expect(codeEl?.textContent).toBe('src/auth.ts')

    // Verify pt-BR localization updates cleanly.
    await act(async () => { await changeLanguage('pt-BR') })
    expect(screen.getByTestId('thread-side-chat')).toHaveTextContent('Respondendo com Codex a partir de um resumo somente leitura desta conversa.')

    // Clean discard closes side-3 and clears store.
    fireEvent.pointerDown(screen.getByTestId('thread-side-chat-actions'), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Descartar e fechar…' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }))
    await waitFor(() => expect(sideClose).toHaveBeenCalledWith('side-3'))
    expect(onClose).toHaveBeenCalled()
    expect(useSideChatStore.getState().chats['t-cross']).toBeUndefined()
  })

  it('supports /btw <question> and Ctrl+. toggle in OxeChat without touching the main conversation', async () => {
    const snap = makeSnapshot('antigravity', 'thread-agy-btw')
    useThreadStore.setState({ selectedId: snap.thread.id, snapshot: snap, threads: [snap.thread], drafts: { [snap.thread.id]: '' } })

    render(<ThreadView threadId={snap.thread.id} active />)
    expect(screen.queryByTestId('thread-side-chat')).toBeNull()

    // Type `/btw why did X fail?` and submit via Enter in the main composer.
    const composer = screen.getByLabelText('Message') as HTMLTextAreaElement
    fireEvent.focus(composer)
    fireEvent.change(composer, { target: { value: '/btw why did X fail?', selectionStart: 20 } })
    fireEvent.keyDown(composer, { key: 'Enter' })

    // Opens Side Chat drawer and sends the question to side chat, NEVER to the main thread!
    expect(await screen.findByTestId('thread-side-chat')).toBeInTheDocument()
    await waitFor(() => expect(sideSend).toHaveBeenCalledWith('side-1', 'why did X fail?'))
    expect(mainSend).not.toHaveBeenCalled()
    expect(mainSendTyped).not.toHaveBeenCalled()

    // Ctrl+. hides the drawer, and pressing Ctrl+. again brings it back with the same copy.
    act(() => { dispatchKeybinding(new KeyboardEvent('keydown', { key: '.', ctrlKey: true, bubbles: true, cancelable: true })) })
    await waitFor(() => expect(screen.queryByTestId('thread-side-chat')).toBeNull())
    expect(sideClose).not.toHaveBeenCalled()

    act(() => { dispatchKeybinding(new KeyboardEvent('keydown', { key: '.', ctrlKey: true, bubbles: true, cancelable: true })) })
    expect(await screen.findByTestId('thread-side-chat')).toBeInTheDocument()
  })

  it('toggles the Side Chat drawer in OxeCode on Ctrl+. powered by active terminal ScreenMirror context without unmounting WorkspaceGrid', async () => {
    setKeyboardView('code')
    const workspace = makeWorkspace()
    render(
      <WorkspaceSurface
        workspace={workspace}
        workspaces={[workspace]}
        isActive
        agentProfiles={useAgentStore.getState().allProfiles}
        maximizedPaneId={null}
        activePaneId="pane-466"
        webPreviewVisible={false}
        integrationVisible={false}
        searchVisible={false}
        onToggleMaximize={vi.fn()}
        onCloseWebPreview={vi.fn()}
        onCloseIntegration={vi.fn()}
        onCloseSearch={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onUpdateEditorState={vi.fn()}
        onUpdateReviewState={vi.fn()}
        onUpdateGitHubState={vi.fn()}
        onUpdateBackgroundState={vi.fn()}
        onUpdateWorktreeState={vi.fn()}
        onRunCommand={vi.fn()}
      />
    )

    expect(screen.queryByTestId('thread-side-chat')).toBeNull()

    // Press Ctrl+. in OxeCode -> opens terminal Side Chat drawer with source='terminal' & active paneId.
    act(() => { dispatchKeybinding(new KeyboardEvent('keydown', { key: '.', ctrlKey: true, bubbles: true, cancelable: true })) })
    const drawer = await screen.findByTestId('thread-side-chat')
    expect(drawer).toHaveAttribute('data-side-source', 'terminal')
    expect(drawer).toHaveTextContent('Terminal snapshot')

    await waitFor(() => expect(sideOpen).toHaveBeenCalledWith(
      terminalSideKey('pane-466'),
      expect.objectContaining({
        source: 'terminal',
        paneId: 'pane-466',
        workspaceId: 'ws-code-466',
        rootPath: '/repo',
        provider: 'antigravity'
      })
    ))

    // Hide cleanly via Ctrl+. again.
    act(() => { dispatchKeybinding(new KeyboardEvent('keydown', { key: '.', ctrlKey: true, bubbles: true, cancelable: true })) })
    await waitFor(() => expect(screen.queryByTestId('thread-side-chat')).toBeNull())
    showSideChat(terminalSideKey('pane-466'), false)
  })

  it('keeps ThreadSideChat.module.css on pure Obsidian Minimal tokens with zero raw color literals', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/Threads/side/ThreadSideChat.module.css'), 'utf8')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/i)
    expect(css).not.toMatch(/--(?:text|border)-/)
    expect(css).toContain('var(--surface-chrome)')
    expect(css).toContain('var(--bd-subtle)')
  })
})
