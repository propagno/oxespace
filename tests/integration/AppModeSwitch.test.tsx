import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../shared/types/workspace'
import { App } from '../../src/App'
import { SKELETON_AFTER_MS } from '../../src/app/viewSwitch'
import { useEditorStore } from '../../src/store/editor.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'
import { usePaneLayoutStore } from '../../src/store/pane-layout.store'
import { useUIStore } from '../../src/store/ui.store'

// OXE-103 (thread-view.spec.ts:310, which failed #790, #792 and #793): OxeChat then OxeCode within 300 ms landed in
// OxeChat, because App dropped the click on the view already on screen and the pending switch then committed.
// OxeChat's chunk never loads here, so the switch is still pending when OxeCode is chosen.
vi.mock('../../src/components/Navigation/ModeViews', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/components/Navigation/ModeViews')>()
  const never = { load: () => new Promise<never>(() => undefined), get: () => undefined }
  const Stub = (): null => null
  return { ...actual, VIEW_CHUNKS: { ...actual.VIEW_CHUNKS, thread: never }, ThreadGrid: Object.assign(Stub, { retry: () => undefined }), ThreadSidebar: Stub }
})
vi.mock('../../src/components/Sidebar/Sidebar', () => ({ Sidebar: () => <aside data-testid="sidebar" /> }))
vi.mock('../../src/components/Workspace/WorkspaceSurface', () => ({ WorkspaceSurface: () => <div data-testid="surface" /> }))
vi.mock('../../src/components/Workspace/NewWorkspaceModal', () => ({ NewWorkspaceModal: () => null }))
vi.mock('../../src/components/Settings/SettingsModal', () => ({ SettingsContent: () => null }))
vi.mock('../../src/components/Agents/AgentConfigModal', () => ({ AgentConfigModal: () => null }))

const modeButton = (mode: string): HTMLButtonElement => {
  const button = document.querySelector<HTMLButtonElement>(`button[data-app-mode="${mode}"]`)
  if (!button) throw new Error(`no ${mode} button`)
  return button
}
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

describe('switching views from the title bar (OXE-103)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.oxe = {
      app: { version: '0.1.4' },
      workspace: {
        list: vi.fn().mockResolvedValue([createWorkspace()]),
        create: vi.fn(),
        setActive: vi.fn(),
        delete: vi.fn().mockResolvedValue(undefined),
        closePane: vi.fn().mockResolvedValue(undefined),
        splitPane: vi.fn().mockResolvedValue(createWorkspace()),
        createPane: vi.fn().mockResolvedValue({ workspace: createWorkspace(), paneId: 'pane-2' }),
        updatePaneType: vi.fn(),
        updateEditorState: vi.fn(),
        pickFolder: vi.fn(),
        shellProfiles: vi.fn().mockResolvedValue([])
      },
      terminal: {} as never,
      agent: {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        discover: vi.fn().mockResolvedValue([]),
        getReadiness: vi.fn().mockResolvedValue([])
      },
      tasks: {} as never,
      background: {
        list: vi.fn().mockResolvedValue([]),
        start: vi.fn(),
        stop: vi.fn(),
        getOutput: vi.fn(),
        onOutput: vi.fn(() => vi.fn()),
        onUpdate: vi.fn(() => vi.fn())
      },
      mcp: {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        callTool: vi.fn(),
        onHealth: vi.fn(() => vi.fn())
      },
      skill: {
        list: vi.fn().mockResolvedValue([]),
        get: vi.fn(),
        invoke: vi.fn(),
        onChange: vi.fn(() => vi.fn())
      },
      fs: {
        listTree: vi.fn(),
        readFile: vi.fn(),
        watchFile: vi.fn(),
        unwatchFile: vi.fn().mockResolvedValue(undefined),
        onFileChanged: vi.fn(() => vi.fn())
      }
    }
    useWorkspaceStore.setState({ workspaces: [createWorkspace()], activeWorkspaceId: 'workspace-1', shellProfiles: [], isLoading: false, error: null })
    useEditorStore.setState({ files: {}, tabs: {}, activePath: {} })
    usePaneLayoutStore.setState({ trees: {} })
    useUIStore.setState({ activePaneId: 'pane-1', splitLayoutEnabled: true })
  })
  afterEach(() => { cleanup() })

  test('OxeChat then OxeCode while OxeChat loads: the latest choice wins and OxeCode stays', async () => {
    render(<App />)
    await act(async () => { await wait(0) })
    await act(async () => { modeButton('thread').click() })
    expect(modeButton('thread')).toHaveAttribute('aria-busy', 'true')
    await act(async () => { modeButton('code').click() })
    expect(modeButton('code')).toHaveAttribute('aria-pressed', 'true')
    await act(async () => { await wait(SKELETON_AFTER_MS + 100) })
    expect(modeButton('code')).toHaveAttribute('aria-pressed', 'true')
    expect(modeButton('thread')).toHaveAttribute('aria-pressed', 'false')
    expect(modeButton('thread')).toHaveAttribute('aria-busy', 'false')
    expect(document.querySelector('main.app-shell')).not.toHaveClass('thread-shell')
  })

  test('a slow OxeChat still opens when nothing else is chosen (its skeleton after 300 ms)', async () => {
    render(<App />)
    await act(async () => { await wait(0) })
    await act(async () => { modeButton('thread').click() })
    await act(async () => { await wait(SKELETON_AFTER_MS + 100) })
    expect(modeButton('thread')).toHaveAttribute('aria-pressed', 'true')
    expect(document.querySelector('main.app-shell')).toHaveClass('thread-shell')
  })
})

function createWorkspace(): Workspace {
  return {
    id: 'workspace-1',
    name: 'repo',
    rootPath: 'C:/repo',
    layout: '1x1',
    defaultShellProfileId: 'builtin-claude',
    autoStart: false,
    isActive: true,
    editorVisible: true,
    editorExpanded: false,
    editorWidthPercent: 40,
    panes: [
      {
        id: 'pane-1',
        workspaceId: 'workspace-1',
        type: 'terminal',
        rowIndex: 0,
        columnIndex: 0,
        shellProfileId: null,
        status: 'idle'
      }
    ]
  }
}
