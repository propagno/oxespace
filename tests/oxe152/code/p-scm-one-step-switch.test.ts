// Frozen acceptance test for 1.5.2 OxeCode A5 (OXE program oxespace-152-code, phase F2, Jira OXE-42, P-SCM).
// Written by the planner; the executor must not edit it.
// Today WorkspaceEditorPanel's "Source control" button awaits two IPC calls in turn (editor off, then GitHub on), and the
// store updates after each, so for a moment both panels are hidden: the dock unmounts and every terminal refits before
// the GitHub panel mounts (diagnosis: scratchpad diag-oxecode-perf.md). Contract: the workspace store exposes
//   showRepositoryView(workspaceId: string, view: 'files' | 'git'): Promise<void>
// which sets both flags in ONE store update before any IPC answers (optimistic), persists afterwards, and puts the
// previous flags back when persisting fails. WorkspaceEditorPanel and WorkspaceGitHubPanel use it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import type { Workspace } from '../../../shared/types/workspace'

type Store = ReturnType<typeof useWorkspaceStore.getState> & { showRepositoryView?: (workspaceId: string, view: 'files' | 'git') => Promise<void> }

const workspace = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: 'ws-1', name: 'repo', rootPath: 'C:/repo', panes: [],
  editorVisible: true, editorExpanded: false, editorWidthPercent: 40,
  githubPanelVisible: false, githubPanelExpanded: false, githubPanelWidthPercent: 40,
  ...overrides
} as unknown as Workspace)

const flags = (): { editorVisible: boolean; githubPanelVisible: boolean } => {
  const item = useWorkspaceStore.getState().workspaces.find(entry => entry.id === 'ws-1')
  return { editorVisible: item?.editorVisible === true, githubPanelVisible: item?.githubPanelVisible === true }
}

let never: Promise<never>
beforeEach(() => {
  never = new Promise<never>(() => undefined)
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, workspace: {
    ...((window as unknown as { oxe?: { workspace?: object } }).oxe?.workspace ?? {}),
    updateEditorState: vi.fn(() => never),
    updateGitHubState: vi.fn(() => never)
  } } })
})
afterEach(() => { vi.restoreAllMocks(); useWorkspaceStore.setState({ workspaces: [] }) })

describe('A5 · Files ↔ Source Control switches in one step (OXE-42)', () => {
  test('the store has showRepositoryView', () => {
    expect(typeof (useWorkspaceStore.getState() as Store).showRepositoryView).toBe('function')
  })

  test('switching to git sets both flags at once, before any IPC answers, with no state where both are off', () => {
    useWorkspaceStore.setState({ workspaces: [workspace()] })
    const seen: Array<{ editorVisible: boolean; githubPanelVisible: boolean }> = []
    const stop = useWorkspaceStore.subscribe(() => { seen.push(flags()) })
    try { void (useWorkspaceStore.getState() as Store).showRepositoryView!('ws-1', 'git') } finally { stop() }
    expect(flags()).toEqual({ editorVisible: false, githubPanelVisible: true })
    expect(seen.some(state => !state.editorVisible && !state.githubPanelVisible)).toBe(false)
  })

  test('switching back to files is one step too', () => {
    useWorkspaceStore.setState({ workspaces: [workspace({ editorVisible: false, githubPanelVisible: true })] })
    const seen: Array<{ editorVisible: boolean; githubPanelVisible: boolean }> = []
    const stop = useWorkspaceStore.subscribe(() => { seen.push(flags()) })
    try { void (useWorkspaceStore.getState() as Store).showRepositoryView!('ws-1', 'files') } finally { stop() }
    expect(flags()).toEqual({ editorVisible: true, githubPanelVisible: false })
    expect(seen.some(state => !state.editorVisible && !state.githubPanelVisible)).toBe(false)
  })

  test('a failed save puts the previous view back', async () => {
    const oxe = (window as unknown as { oxe: { workspace: Record<string, unknown> } }).oxe
    oxe.workspace.updateEditorState = vi.fn(async () => { throw new Error('disk full') })
    oxe.workspace.updateGitHubState = vi.fn(async () => { throw new Error('disk full') })
    useWorkspaceStore.setState({ workspaces: [workspace()] })
    await (useWorkspaceStore.getState() as Store).showRepositoryView!('ws-1', 'git').catch(() => undefined)
    await vi.waitFor(() => expect(flags()).toEqual({ editorVisible: true, githubPanelVisible: false }))
  })

  test('the Files and Source Control buttons use it', () => {
    // rigor: source-assertion — the two panels mount Monaco and the GitHub client; the behaviour is proven above on the
    // store, and this pins that both buttons go through it instead of two awaited calls.
    const editor = readFileSync(join(process.cwd(), 'src/components/Workspace/WorkspaceEditorPanel.tsx'), 'utf8')
    const github = readFileSync(join(process.cwd(), 'src/components/Workspace/WorkspaceGitHubPanel.tsx'), 'utf8')
    expect(editor).toMatch(/showRepositoryView\(\s*workspace\.id\s*,\s*'git'\s*\)/)
    expect(github).toMatch(/showRepositoryView\(\s*workspace\.id\s*,\s*'files'\s*\)/)
  })
})
