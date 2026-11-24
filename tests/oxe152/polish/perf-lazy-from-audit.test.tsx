import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Component, Suspense, type ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AgentCreditsSnapshot } from '../../../shared/types/agentCredits'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import { chunk, lazyFrom } from '../../../src/lib/chunk'
import { HIGH_HEAP_USE, VIEW_PRELOAD_MIN_MEMORY_GB } from '../../../src/lib/idlePreload'
import { useAgentCreditsStore } from '../../../src/store/agentCredits.store'

const stub = (testid: string) => () => <div data-testid={testid} />

vi.mock('../../../src/components/Changes/ChangesPanel', () => ({ ChangesPanel: stub('mock-changes-panel') }))
vi.mock('../../../src/components/GitHub/GitControlPanel', () => ({ GitControlPanel: stub('mock-git-panel') }))
vi.mock('../../../src/components/Editor/EditorPane', () => ({ EditorPane: stub('mock-editor-pane') }))
vi.mock('../../../src/components/Search/SearchPanel', () => ({ SearchPanel: stub('mock-search-panel') }))
vi.mock('../../../src/components/Background/BackgroundJobsPanel', () => ({ BackgroundJobsPanel: stub('mock-background-panel') }))
vi.mock('../../../src/components/WebPreview/WebPreviewPanel', () => ({ WebPreviewPanel: stub('mock-web-preview-panel') }))
vi.mock('../../../src/components/Threads/ThreadProjectTerminal', () => ({ ThreadProjectTerminal: stub('mock-thread-terminal') }))
vi.mock('../../../src/components/Threads/ThreadNetworkPanel', () => ({ ThreadNetworkPanel: stub('mock-thread-network') }))
vi.mock('../../../src/components/Android/AndroidPanel', () => ({ AndroidPanel: stub('mock-android-panel') }))
vi.mock('../../../src/components/OxeQuery/ActivityPanel', () => ({ ActivityPanel: stub('mock-activity-panel') }))
vi.mock('../../../src/components/Containers/ContainersPanel', () => ({ ContainersPanel: stub('mock-containers-panel') }))
vi.mock('../../../src/components/Threads/ThreadMath', () => ({ MathView: ({ tex }: { tex: string }) => <span data-testid="mock-math-view">{tex}</span> }))
vi.mock('../../../src/components/Threads/ThreadMermaid', () => ({ MermaidDiagram: ({ code }: { code: string }) => <div data-testid="mock-mermaid-view">{code}</div> }))
vi.mock('../../../src/components/Workspace/UsagePopover', () => ({ UsagePopover: stub('mock-usage-popover') }))
vi.mock('../../../src/components/Grid/ProviderSessionFinder', () => ({ ProviderSessionFinder: stub('mock-provider-session-finder') }))
vi.mock('../../../src/components/Panes/PaneContent', () => ({ PaneContent: stub('mock-pane-content') }))
vi.mock('../../../src/components/Workspace/WorkspaceHttpCallsPanel', () => ({ WorkspaceHttpCallsPanel: stub('mock-ws-http-calls-panel') }))
vi.mock('../../../src/components/Workspace/WorkspaceAndroidPanel', () => ({ WorkspaceAndroidPanel: stub('mock-ws-android-panel') }))
vi.mock('../../../src/components/Workspace/IntegrationsStatusChips', () => ({ IntegrationsStatusChips: stub('mock-integrations-chips') }))
vi.mock('../../../src/components/Threads/ThreadCommandDialog', () => ({ default: stub('mock-thread-command-dialog') }))
vi.mock('../../../src/components/Threads/ThreadReviewHost', () => ({ default: stub('mock-thread-review-host') }))
vi.mock('../../../src/ui/ToastStack', () => ({ default: () => <section data-testid="mock-toast-stack" /> }))

class TestErrorBoundary extends Component<{ children: ReactNode; onError?: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  componentDidCatch(): void { this.props.onError?.() }
  reset(): void { this.setState({ failed: false }) }
  render(): ReactNode { return this.state.failed ? <div data-testid="error-boundary">failed</div> : this.props.children }
}

function makeWorkspace(): Workspace {
  return {
    id: 'ws-1',
    name: 'repo',
    rootPath: 'C:/repo',
    layout: '1x1',
    layoutPreset: 1,
    themeId: 'midnight',
    uiDensity: 'compact',
    defaultShellProfileId: 'builtin-claude',
    autoStart: false,
    isActive: true,
    panes: [{
      id: 'pane-1',
      workspaceId: 'ws-1',
      type: 'terminal',
      rowIndex: 0,
      columnIndex: 0,
      shellProfileId: 'builtin-claude',
      status: 'running',
      agentProfileId: null,
      agentName: null,
      displayName: null,
      createdAt: null,
      modelOverride: null,
      rootPath: null
    }]
  } as Workspace
}

function makeThreadSnapshot(): ThreadSnapshot {
  return {
    thread: {
      id: 'thread-1',
      workspaceId: 'ws-1',
      rootPath: 'C:/repo',
      title: 'Test thread',
      provider: 'claude',
      status: 'idle',
      createdAt: 1,
      updatedAt: 1
    },
    events: []
  } as unknown as ThreadSnapshot
}

function makeUsageSnapshot(): AgentCreditsSnapshot {
  return {
    provider: 'claude',
    available: true,
    installed: true,
    planLabel: 'max',
    source: 'oauth',
    observedAtMs: Date.now() - 1000,
    error: null,
    display: { kind: 'session', usedPct: 35, resetsAtMs: null },
    windows: [{ kind: 'session', usedPct: 35, resetsAtMs: null }]
  } as AgentCreditsSnapshot
}

function observeAddedNodes(predicate: (el: HTMLElement) => boolean): { hits: string[]; disconnect: () => void } {
  const hits: string[] = []
  const observer = new MutationObserver(records => {
    for (const record of records) {
      record.addedNodes.forEach(node => {
        if (node instanceof HTMLElement && predicate(node)) hits.push(node.outerHTML.slice(0, 80))
      })
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  return { hits, disconnect: () => observer.disconnect() }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAgentCreditsStore.setState({ byProvider: {}, loading: {} })
  delete (window as unknown as { oxe?: unknown }).oxe
})

describe('OXE-57 · lazyFrom shared chunks audit (OxeCode & OxeChat)', () => {
  test('renders preloaded OxeCode and OxeChat surfaces via shared lazyFrom chunks with zero Suspense fallback ticks and preserves retry', async () => {
    // 1. Verify RetryableLazy.retry() recovers after a rejected dynamic import
    let attempts = 0
    const flaky = chunk(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('chunk network error')
      return { Recovered: () => <div data-testid="recovered-lazy">ok</div> }
    })
    const FlakyView = lazyFrom(flaky, m => m.Recovered)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let boundaryRef: TestErrorBoundary | null = null
    const { rerender: rerenderRetry } = render(
      <TestErrorBoundary ref={ref => { boundaryRef = ref }}>
        <Suspense fallback={<div data-testid="retry-fallback">loading</div>}>
          <FlakyView />
        </Suspense>
      </TestErrorBoundary>
    )
    await vi.waitFor(() => expect(screen.queryByTestId('error-boundary')).not.toBeNull())
    expect(attempts).toBe(1)
    FlakyView.retry()
    act(() => { boundaryRef?.reset() })
    rerenderRetry(
      <TestErrorBoundary ref={ref => { boundaryRef = ref }}>
        <Suspense fallback={<div data-testid="retry-fallback">loading</div>}>
          <FlakyView />
        </Suspense>
      </TestErrorBoundary>
    )
    await vi.waitFor(() => expect(screen.queryByTestId('recovered-lazy')).not.toBeNull())
    expect(attempts).toBe(2)
    consoleError.mockRestore()
    cleanup()

    // 2. Preload shared panel chunks and render ThreadChangesPanel with zero Suspense fallback ticks
    const { SHARED_PANEL_CHUNKS } = await import('../../../src/lib/panelChunks')
    await Promise.all(Object.values(SHARED_PANEL_CHUNKS).map(c => c.load()))
    for (const c of Object.values(SHARED_PANEL_CHUNKS)) expect(c.get()).toBeDefined()

    const { ThreadChangesPanel } = await import('../../../src/components/Threads/ThreadChangesPanel')
    const snapshot = makeThreadSnapshot()
    const workspace = makeWorkspace()
    const panelCases: Array<{ panel: 'changes' | 'git' | 'files' | 'search' | 'background' | 'preview' | 'network' | 'android' | 'terminal'; testid: string }> = [
      { panel: 'changes', testid: 'mock-changes-panel' },
      { panel: 'git', testid: 'mock-git-panel' },
      { panel: 'files', testid: 'mock-editor-pane' },
      { panel: 'search', testid: 'mock-search-panel' },
      { panel: 'background', testid: 'mock-background-panel' },
      { panel: 'preview', testid: 'mock-web-preview-panel' },
      { panel: 'network', testid: 'mock-thread-network' },
      { panel: 'android', testid: 'mock-android-panel' },
      { panel: 'terminal', testid: 'mock-thread-terminal' }
    ]

    for (const item of panelCases) {
      const watch = observeAddedNodes(el => el.getAttribute('role') === 'status' || Boolean(el.querySelector('[role="status"]')))
      act(() => {
        render(<ThreadChangesPanel snapshot={snapshot} workspace={workspace} panel={item.panel} onClose={() => undefined} />)
      })
      expect(screen.queryByTestId(item.testid)).not.toBeNull()
      watch.disconnect()
      expect(watch.hits).toEqual([])
      cleanup()
    }

    // 3. ThreadToolTabs renders preloaded Changes, Queries (ActivityPanel), and Containers in the same tick
    const { ThreadToolTabs } = await import('../../../src/components/Threads/ThreadToolTabs')
    ;(window as unknown as { oxe?: unknown }).oxe = {
      thread: {
        toolTabs: vi.fn(async () => [
          { tab: 'conversation', count: null },
          { tab: 'changes', count: 1 },
          { tab: 'queries', count: 1 },
          { tab: 'containers', count: 1 }
        ])
      }
    }
    const { rerender: rerenderTabs } = render(
      <ThreadToolTabs threadId="thread-1" workspaceId="ws-1" rootPath="C:/repo" activeTab="conversation" />
    )
    await vi.waitFor(() => expect(screen.queryByRole('tab', { name: /Changes|Alterações/i })).not.toBeNull())
    for (const [tab, testid] of [['changes', 'mock-changes-panel'], ['queries', 'mock-activity-panel'], ['containers', 'mock-containers-panel']] as const) {
      act(() => {
        rerenderTabs(<ThreadToolTabs threadId="thread-1" workspaceId="ws-1" rootPath="C:/repo" activeTab={tab} />)
      })
      expect(screen.queryByTestId(testid)).not.toBeNull()
    }
    cleanup()

    // 4. ThreadMarkdown renders preloaded MathView and MermaidDiagram with zero fallback ticks
    const { THREAD_MATH_CHUNK, THREAD_MERMAID_CHUNK, ThreadMarkdown } = await import('../../../src/components/Threads/ThreadMarkdown')
    await Promise.all([THREAD_MATH_CHUNK.load(), THREAD_MERMAID_CHUNK.load()])
    const mdWatch = observeAddedNodes(el => el.classList.contains('thread-code-block') || el.classList.contains('thread-math-source') || Boolean(el.querySelector('.thread-code-block, .thread-math-source')))
    act(() => {
      render(<ThreadMarkdown text={'```math\nx^2 + 1\n```\n\n```mermaid\ngraph TD\nA-->B\n```'} />)
    })
    expect(screen.queryByTestId('mock-math-view')).not.toBeNull()
    expect(screen.queryByTestId('mock-mermaid-view')).not.toBeNull()
    mdWatch.disconnect()
    expect(mdWatch.hits).toEqual([])
    cleanup()

    // 5. UsageStatus renders preloaded UsagePopover in the same commit on click
    const { USAGE_POPOVER_CHUNK, UsageStatus } = await import('../../../src/components/Workspace/UsageStatus')
    await USAGE_POPOVER_CHUNK.load()
    useAgentCreditsStore.setState({ byProvider: { claude: makeUsageSnapshot() }, loading: {} })
    render(<UsageStatus provider="claude" />)
    act(() => { fireEvent.click(screen.getByTestId('usage-status')) })
    expect(screen.queryByTestId('mock-usage-popover')).not.toBeNull()
    cleanup()

    // 6. Toaster renders preloaded ToastStack synchronously when a toast is queued
    const { TOAST_STACK_CHUNK, Toaster, toast, dismissToast } = await import('../../../src/ui/Toast')
    await TOAST_STACK_CHUNK.load()
    let id = 0
    act(() => { id = toast({ title: 'Ready' }) })
    act(() => { render(<Toaster />) })
    expect(screen.queryByTestId('mock-toast-stack')).not.toBeNull()
    act(() => { dismissToast(id) })
    cleanup()

    // 7. WorkspaceSurface extra chunks and ThreadView dialog/review chunks resolve synchronously once preloaded
    const {
      WORKSPACE_HTTP_CALLS_PANEL_CHUNK,
      WORKSPACE_ANDROID_PANEL_CHUNK,
      INTEGRATIONS_STATUS_CHIPS_CHUNK
    } = await import('../../../src/lib/panelChunks')
    const { THREAD_COMMAND_DIALOG_CHUNK, THREAD_REVIEW_HOST_CHUNK } = await import('../../../src/components/Threads/ThreadView')
    await Promise.all([
      WORKSPACE_HTTP_CALLS_PANEL_CHUNK.load(),
      WORKSPACE_ANDROID_PANEL_CHUNK.load(),
      INTEGRATIONS_STATUS_CHIPS_CHUNK.load(),
      THREAD_COMMAND_DIALOG_CHUNK.load(),
      THREAD_REVIEW_HOST_CHUNK.load()
    ])
    const SyncHttpCalls = lazyFrom(WORKSPACE_HTTP_CALLS_PANEL_CHUNK, m => m.WorkspaceHttpCallsPanel)
    const SyncAndroid = lazyFrom(WORKSPACE_ANDROID_PANEL_CHUNK, m => m.WorkspaceAndroidPanel)
    const SyncChips = lazyFrom(INTEGRATIONS_STATUS_CHIPS_CHUNK, m => m.IntegrationsStatusChips)
    const SyncCmd = lazyFrom(THREAD_COMMAND_DIALOG_CHUNK, m => m.default)
    const SyncReview = lazyFrom(THREAD_REVIEW_HOST_CHUNK, m => m.default)
    const extraWatch = observeAddedNodes(el => el.dataset.testid === 'extra-fallback')
    act(() => {
      render(
        <Suspense fallback={<div data-testid="extra-fallback" />}>
          <SyncHttpCalls workspace={workspace} isExpanded={false} onCollapse={() => undefined} onToggleExpanded={() => undefined} />
          <SyncAndroid isExpanded={false} onCollapse={() => undefined} onToggleExpanded={() => undefined} />
          <SyncChips workspace={workspace} isActive />
          <SyncCmd panel={{ kind: 'output', title: 't', text: 'ok' } as never} snapshot={snapshot} pending={false} error="" onClose={() => undefined} onError={() => undefined} action={async () => undefined} runCommand={async () => undefined} />
          <SyncReview snapshot={snapshot} workspace={workspace} panel="changes" drawer={false} availableWidth={1000} workbench={{ current: null }} onClose={() => undefined} onReturnFocus={() => undefined} onSendToConversation={() => undefined} />
        </Suspense>
      )
    })
    expect(screen.queryByTestId('mock-ws-http-calls-panel')).not.toBeNull()
    expect(screen.queryByTestId('mock-ws-android-panel')).not.toBeNull()
    expect(screen.queryByTestId('mock-integrations-chips')).not.toBeNull()
    expect(screen.queryByTestId('mock-thread-command-dialog')).not.toBeNull()
    expect(screen.queryByTestId('mock-thread-review-host')).not.toBeNull()
    extraWatch.disconnect()
    expect(extraWatch.hits).toEqual([])
  }, 30_000)

  test('shares identical chunk instances between OxeCode WorkspaceSurface and OxeChat ThreadChangesPanel', async () => {
    const libChunks = await import('../../../src/lib/panelChunks')
    const wsChunks = await import('../../../src/components/Workspace/panelChunks')

    // Referential identity across both import paths and between OxeCode and OxeChat registries
    expect(wsChunks.CHANGES_PANEL_CHUNK).toBe(libChunks.CHANGES_PANEL_CHUNK)
    expect(libChunks.SHARED_PANEL_CHUNKS.changes).toBe(libChunks.CHANGES_PANEL_CHUNK)
    expect(wsChunks.WORKSPACE_PANEL_CHUNKS).toBe(libChunks.WORKSPACE_PANEL_CHUNKS)
    expect(wsChunks.SHARED_PANEL_CHUNKS).toBe(libChunks.SHARED_PANEL_CHUNKS)
    expect(wsChunks.WORKSPACE_HTTP_CALLS_PANEL_CHUNK).toBe(libChunks.WORKSPACE_HTTP_CALLS_PANEL_CHUNK)
    expect(wsChunks.WORKSPACE_ANDROID_PANEL_CHUNK).toBe(libChunks.WORKSPACE_ANDROID_PANEL_CHUNK)
    expect(wsChunks.INTEGRATIONS_STATUS_CHIPS_CHUNK).toBe(libChunks.INTEGRATIONS_STATUS_CHIPS_CHUNK)

    // Risco 1 / CA-2: src/lib/panelChunks.ts must use ONLY dynamic () => import(...) factories, zero static panel imports
    const panelChunksSource = readFileSync(resolve(process.cwd(), 'src/lib/panelChunks.ts'), 'utf8')
    const staticImports = [...panelChunksSource.matchAll(/^\s*import\s+.+?\s+from\s+['"]([^'"]+)['"]/gm)].map(m => m[1])
    expect(staticImports).toEqual(['./chunk'])

    // CA-1 / CA-3: all 8 migrated target files use lazyFrom() with zero plain React.lazy() calls
    const migratedFiles = [
      'src/components/Workspace/WorkspaceSurface.tsx',
      'src/components/Threads/ThreadChangesPanel.tsx',
      'src/components/Threads/ThreadToolTabs.tsx',
      'src/components/Threads/ThreadView.tsx',
      'src/components/Threads/ThreadMarkdown.tsx',
      'src/components/Workspace/UsageStatus.tsx',
      'src/components/Grid/PaneContainer.tsx',
      'src/ui/Toast.tsx'
    ]
    for (const rel of migratedFiles) {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf8')
      expect(src, `${rel} should not call plain lazy()`).not.toMatch(/\blazy\s*\(/)
      expect(src, `${rel} should use lazyFrom()`).toMatch(/\blazyFrom\s*\(/)
    }

    // Shared panel registry imported by all 3 panel hosts
    for (const rel of [
      'src/components/Workspace/WorkspaceSurface.tsx',
      'src/components/Threads/ThreadChangesPanel.tsx',
      'src/components/Threads/ThreadToolTabs.tsx'
    ]) {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf8')
      expect(src, `${rel} should consume src/lib/panelChunks`).toMatch(/from\s+['"]\.\.\/\.\.\/lib\/panelChunks['"]/)
    }

    // CA-2: idlePreload.ts guards intact and no panelChunks added to idlePreload
    expect(VIEW_PRELOAD_MIN_MEMORY_GB).toBe(8)
    expect(HIGH_HEAP_USE).toBe(0.7)
    const idlePreloadSource = readFileSync(resolve(process.cwd(), 'src/lib/idlePreload.ts'), 'utf8')
    expect(idlePreloadSource).not.toContain('panelChunks')

    // CA-3: rare administrative modals intentionally remain on plain React.lazy()
    const rareModals = [
      'src/components/About/AboutHost.tsx',
      'src/components/Diagnostics/ReportProblemHost.tsx',
      'src/components/Keyboard/ShortcutGuideHost.tsx',
      'src/components/Schedules/SchedulesHost.tsx',
      'src/components/Remote/RemotePairingHost.tsx',
      'src/components/AgentSessions/AgentHooksPromptHost.tsx',
      'src/components/Updates/RemovedFeaturesBand.tsx',
      'src/components/Updates/whatsNew.tsx'
    ]
    for (const rel of rareModals) {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf8')
      expect(src, `${rel} should remain on plain React.lazy()`).toMatch(/\blazy\s*\(/)
    }
  })

  test('warms UsagePopover and ProviderSessionFinder only on pointer or focus intent, never on mount', async () => {
    const { USAGE_POPOVER_CHUNK, UsageStatus } = await import('../../../src/components/Workspace/UsageStatus')
    const usageSpy = vi.spyOn(USAGE_POPOVER_CHUNK, 'load')
    useAgentCreditsStore.setState({ byProvider: { claude: makeUsageSnapshot() }, loading: {} })

    render(<UsageStatus provider="claude" />)
    expect(usageSpy).not.toHaveBeenCalled()

    const trigger = screen.getByTestId('usage-status')
    fireEvent.mouseEnter(trigger)
    expect(usageSpy).toHaveBeenCalledTimes(1)
    fireEvent.focus(trigger)
    expect(usageSpy).toHaveBeenCalledTimes(2)
    cleanup()

    const { PROVIDER_SESSION_FINDER_CHUNK, PaneContainer } = await import('../../../src/components/Grid/PaneContainer')
    const finderSpy = vi.spyOn(PROVIDER_SESSION_FINDER_CHUNK, 'load')
    const workspace = makeWorkspace()
    render(
      <PaneContainer
        pane={workspace.panes[0]}
        workspace={workspace}
        agentProfile={null}
        autoStart={false}
        isMaximized={false}
        onToggleMaximize={() => undefined}
      />
    )
    expect(finderSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /More|Mais/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Details|Detalhes/i }))
    const findBtn = await screen.findByRole('button', { name: /Find|Procurar|Buscar|sess/i })
    expect(finderSpy).not.toHaveBeenCalled()
    fireEvent.mouseEnter(findBtn)
    expect(finderSpy).toHaveBeenCalledTimes(1)
    fireEvent.focus(findBtn)
    expect(finderSpy).toHaveBeenCalledTimes(2)
  })
})

// OXE-309: a dock wrapper that statically imports a shared panel warms that panel's SHARED_PANEL_CHUNKS entry when it
// loads, so the same panel opened later from OxeChat (ThreadChangesPanel, ThreadToolTabs) renders with no Suspense
// fallback. The registry keeps one chunk identity and only dynamic imports.
describe('OXE-309 · a loaded dock wrapper warms its shared panel chunk', () => {
  test('loading workspace dock wrapper warms corresponding SHARED_PANEL_CHUNKS entry for zero cross-mode suspense', async () => {
    vi.resetModules()
    const lib = await import('../../../src/lib/panelChunks')
    const pairs = [
      [lib.WORKSPACE_PANEL_CHUNKS.background, 'background'],
      [lib.WORKSPACE_PANEL_CHUNKS.editor, 'files'],
      [lib.WORKSPACE_PANEL_CHUNKS.github, 'git'],
      [lib.WORKSPACE_PANEL_CHUNKS.search, 'search'],
      [lib.WORKSPACE_PANEL_CHUNKS.containers, 'containers'],
      [lib.WORKSPACE_PANEL_CHUNKS.webPreview, 'webPreview'],
      [lib.WORKSPACE_HTTP_CALLS_PANEL_CHUNK, 'httpCalls'],
      [lib.WORKSPACE_ANDROID_PANEL_CHUNK, 'android']
    ] as const
    for (const [, shared] of pairs) expect(lib.SHARED_PANEL_CHUNKS[shared].get(), `${shared} before its wrapper`).toBeUndefined()

    for (const [wrapper, shared] of pairs) {
      await wrapper.load()
      await vi.waitFor(() => expect(lib.SHARED_PANEL_CHUNKS[shared].get(), `${shared} after its wrapper`).toBeDefined())
    }

    // Opened from OxeChat afterwards: the panel is there in the first commit, never behind the fallback.
    const Git = lazyFrom(lib.SHARED_PANEL_CHUNKS.git, m => m.GitControlPanel as unknown as () => ReactNode)
    const Files = lazyFrom(lib.SHARED_PANEL_CHUNKS.files, m => m.EditorPane as unknown as () => ReactNode)
    render(<Suspense fallback={<div data-testid="cross-mode-fallback" />}><Git /><Files /></Suspense>)
    expect(screen.queryByTestId('cross-mode-fallback')).toBeNull()
    expect(screen.getByTestId('mock-git-panel')).toBeInTheDocument()
    expect(screen.getByTestId('mock-editor-pane')).toBeInTheDocument()

    // Still one registry and only dynamic imports in it.
    const source = readFileSync(resolve(process.cwd(), 'src/lib/panelChunks.ts'), 'utf8')
    expect([...source.matchAll(/^\s*import\s+.+?\s+from\s+['"]([^'"]+)['"]/gm)].map(m => m[1])).toEqual(['./chunk'])
  })
})

// OXE-308: the remaining frequent OxeCode surfaces render their lazy parts through lazyFrom(chunk), which resolves at
// once when the chunk has arrived and can be retried after a failed load (RetryableLazy.retry), instead of a plain
// React.lazy that holds the Suspense fallback ~300 ms every first time. One file per line, so each later part only adds.
describe('OXE-308 · remaining OxeCode surfaces on lazyFrom', () => {
  test('remaining interactive OxeCode surfaces use lazyFrom with retry support', () => {
    const migrated = [
      'src/components/Changes/ChangesPanel.tsx',
      'src/components/Editor/EditorPane.tsx',
      'src/components/Panes/PaneContent.tsx',
      'src/components/AgentSessions/PaneResume.tsx',
    ]
    for (const rel of migrated) {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf8')
      expect(src, `${rel} should not call plain lazy()`).not.toMatch(/\blazy\s*\(/)
      expect(src, `${rel} should use lazyFrom()`).toMatch(/\blazyFrom\s*\(/)
      expect(src, `${rel} should load through chunk() or a shared panel chunk`).toMatch(/\bchunk\s*\(|SHARED_PANEL_CHUNKS\./)
    }
    // lazyFrom is what gives each of them RetryableLazy.retry() (covered by the OXE-57 retry case above).
    // PaneContent's editor is the same chunk OxeCode's dock and OxeChat use, not a second one.
    expect(readFileSync(resolve(process.cwd(), 'src/components/Panes/PaneContent.tsx'), 'utf8')).toMatch(/SHARED_PANEL_CHUNKS\.files/)
  })
})
