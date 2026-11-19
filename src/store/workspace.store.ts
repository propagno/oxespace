import { create, type StoreApi } from 'zustand'
import type { CreateWorkspaceInput, ShellProfile, UpdateWorkspaceBackgroundStateInput, UpdateWorkspaceEditorStateInput, UpdateWorkspaceGitHubStateInput, UpdateWorkspaceReviewStateInput, UpdateWorkspaceSettingsInput, UpdateWorkspaceWorktreeStateInput, Workspace } from '../../shared/types/workspace'
import { isWorkspaceCreateRefusal } from '../../shared/types/workspace'
import { i18n } from '../i18n'
import { humanizeError } from '../utils/humanizeError'
import { optimistic } from './optimistic'
import { useUIStore } from './ui.store'

/** Keeps the UI store's active pane aligned with the grid's focus when a workspace loads or switches. */
function syncActivePane(workspace: Workspace | undefined): void {
  if (!workspace) return
  const currentPaneId = useUIStore.getState().activePaneId
  if (currentPaneId && workspace.panes.some((pane) => pane.id === currentPaneId)) return
  const firstPane =
    workspace.panes.find((pane) => pane.type === 'terminal' && pane.rowIndex >= 0 && pane.columnIndex >= 0) ??
    workspace.panes[0]
  if (firstPane) useUIStore.getState().setActivePane(firstPane.id)
}

interface WorkspaceState {
  workspaces: Workspace[]
  shellProfiles: ShellProfile[]
  activeWorkspaceId: string | null
  isLoading: boolean
  error: string | null
  bootstrap: () => Promise<void>
  loadShellProfiles: () => Promise<void>
  createWorkspace: (input: CreateWorkspaceInput) => Promise<Workspace>
  setActiveWorkspace: (id: string) => Promise<void>
  closeWorkspace: (id: string) => Promise<void>
  closePane: (id: string) => Promise<void>
  splitPane: (paneId: string, direction: 'vertical' | 'horizontal') => Promise<void>
  createPane: (workspaceId: string) => Promise<string>
  /** A workspace the main process changed on its own (see workspace.onChanged). */
  applyWorkspace: (workspace: import('../../shared/types/workspace').Workspace) => void
  updatePaneType: (paneId: string, type: Workspace['panes'][number]['type']) => Promise<void>
  updatePaneName: (paneId: string, displayName: string | null) => Promise<void>
  setPaneAgent: (paneId: string, agentProfileId: string | null, options?: { preserveSession?: boolean }) => Promise<void>
  setPaneRootPath: (paneId: string, rootPath: string | null) => Promise<void>
  updateEditorState: (input: UpdateWorkspaceEditorStateInput) => Promise<void>
  updateReviewState: (input: UpdateWorkspaceReviewStateInput) => Promise<void>
  updateGitHubState: (input: UpdateWorkspaceGitHubStateInput) => Promise<void>
  /** Files ↔ Source Control in one store update; persisted afterwards, the previous flags back on failure (OXE-42). */
  showRepositoryView: (workspaceId: string, view: 'files' | 'git') => Promise<void>
  updateBackgroundState: (input: UpdateWorkspaceBackgroundStateInput) => Promise<void>
  updateWorktreeState: (input: UpdateWorkspaceWorktreeStateInput) => Promise<void>
  reorderWorkspaces: (orderedIds: string[]) => Promise<void>
  updateSettings: (input: UpdateWorkspaceSettingsInput) => Promise<void>
  clearError: () => void
}

/** The list with the saved workspace in place of its cached copy. */
const replaced = (workspaces: Workspace[], workspace: Workspace): Workspace[] => workspaces.map((item) => (item.id === workspace.id ? workspace : item))

/** The saved workspace replaces its cached copy, and the error clears. */
const withSaved = (workspace: Workspace) => (state: WorkspaceState): Partial<WorkspaceState> => ({ workspaces: replaced(state.workspaces, workspace), error: null })

/** Saves a side panel's state: the saved workspace replaces its cached copy; a failure shows as the store's error. */
async function savePanelState(set: StoreApi<WorkspaceState>['setState'], save: () => Promise<Workspace>): Promise<void> {
  try {
    set(withSaved(await save()))
  } catch (err) {
    set({ error: humanizeError(err, i18n.t('failures.workspace.panelState')) })
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  shellProfiles: [],
  activeWorkspaceId: null,
  isLoading: false,
  error: null,

  bootstrap: async () => {
    set({ isLoading: true, error: null })
    try {
      const [workspaces, shellProfiles] = await Promise.all([window.oxe.workspace.list(), window.oxe.workspace.shellProfiles()])
      const activeWorkspace = workspaces.find((workspace) => workspace.isActive) ?? workspaces[0]
      set({
        workspaces,
        shellProfiles,
        activeWorkspaceId: activeWorkspace?.id ?? null,
        isLoading: false
      })
      syncActivePane(activeWorkspace)
    } catch (error) {
      set({ error: toMessage(error), isLoading: false })
    }
  },

  loadShellProfiles: async () => {
    try {
      const shellProfiles = await window.oxe.workspace.shellProfiles()
      set({ shellProfiles, error: null })
    } catch (error) {
      set({ error: toMessage(error) })
    }
  },

  createWorkspace: async (input) => {
    const workspace = await window.oxe.workspace.create(input)
    if (isWorkspaceCreateRefusal(workspace)) {
      // The main process wrote nothing: say why in the interface language and fail the call, as before.
      // Loaded on a refusal only, so the message catalogue stays out of the boot bundle.
      const [{ messageKey, messageValues }, { i18n }] = await Promise.all([import('../../shared/messages'), import('../i18n')])
      const { message } = workspace
      const tm = i18n.getFixedT(null, 'main') as unknown as (key: string, values: Record<string, string>) => string
      throw new Error(tm(messageKey(message.code), messageValues(message, i18n.language)))
    }
    set((state) => ({
      // The main process can return an existing workspace for this folder.
      // Replace that row instead of inserting the same ID a second time.
      workspaces: [workspace, ...state.workspaces.filter((item) => item.id !== workspace.id).map((item) => ({ ...item, isActive: false }))],
      activeWorkspaceId: workspace.id,
      error: null
    }))
    syncActivePane(workspace)
    return workspace
  },

  setActiveWorkspace: async (id) => {
    // Optimistic switch — flip the active id BEFORE the
    // IPC roundtrips. Previously we awaited the SQLite transaction + full
    // workspace re-fetch before updating, which made every sidebar click
    // pay 100-300ms of "loading" lag for the workspace-host CSS swap.
    // The IPC is fire-and-persist: persistence still happens (so a
    // restart picks the right active workspace) but the UI doesn't wait.
    const previousActiveId = get().activeWorkspaceId
    if (previousActiveId === id) return
    const targetWorkspace = get().workspaces.find((workspace) => workspace.id === id)
    set({
      activeWorkspaceId: id,
      error: null
    })
    syncActivePane(targetWorkspace)
    try {
      // Activation persistence changes only `is_active`; the optimistic state
      // above already contains the complete authoritative result. Replacing
      // the workspace with a freshly mapped backend object caused a second
      // App + every mounted WorkspaceSurface render after each switch.
      await window.oxe.workspace.setActive(id)
    } catch (err) {
      // Rollback the optimistic flip so the UI doesn't lie about state.
      set({
        activeWorkspaceId: previousActiveId,
        error: humanizeError(err, i18n.t('failures.workspace.switch'))
      })
    }
  },

  closeWorkspace: async (id) => {
    // The workspace leaves the sidebar at once; a failed delete puts it back with a toast.
    await optimistic(set, get, (state) => {
      const remaining = state.workspaces.filter((workspace) => workspace.id !== id)
      const nextActiveId = state.activeWorkspaceId === id ? remaining[0]?.id ?? null : state.activeWorkspaceId
      return {
        workspaces: remaining.map((workspace) => ({ ...workspace, isActive: workspace.id === nextActiveId })),
        activeWorkspaceId: nextActiveId,
        error: null
      }
    }, () => window.oxe.workspace.delete(id), { rollbackMessage: i18n.t('code:workspace.closeFailed') })
  },

  closePane: async (id) => {
    const updated = await window.oxe.workspace.closePane(id)
    set((state) => ({
      workspaces: state.workspaces.map((workspace) => {
        if (updated && workspace.id === updated.id) return updated
        // Fallback for when the pane was already gone server-side: still drop it
        // from the local store so the UI doesn't keep a stale row.
        return { ...workspace, panes: workspace.panes.filter((pane) => pane.id !== id) }
      }),
      error: null
    }))
  },

  splitPane: async (paneId, direction) => {
    const workspace = await window.oxe.workspace.splitPane({ paneId, direction })
    set(withSaved(workspace))
  },

  applyWorkspace: (workspace) => {
    set((state) => ({ workspaces: replaced(state.workspaces, workspace) }))
    if (workspace.id === get().activeWorkspaceId) syncActivePane(workspace)
  },

  createPane: async (workspaceId) => {
    const { workspace, paneId } = await window.oxe.workspace.createPane({ workspaceId })
    set(withSaved(workspace))
    return paneId
  },

  updatePaneType: async (paneId, type) => {
    const workspace = await window.oxe.workspace.updatePaneType({ paneId, type })
    set(withSaved(workspace))
  },

  updatePaneName: async (paneId, displayName) => {
    const workspace = await window.oxe.workspace.updatePaneName({ paneId, displayName })
    set(withSaved(workspace))
  },

  setPaneAgent: async (paneId, agentProfileId, options) => {
    const workspace = await window.oxe.workspace.setPaneAgent({ paneId, agentProfileId, preserveSession: options?.preserveSession })
    set(withSaved(workspace))
  },

  setPaneRootPath: async (paneId, rootPath) => {
    const workspace = await window.oxe.workspace.setPaneRootPath({ paneId, rootPath })
    set(withSaved(workspace))
  },

  updateEditorState: async (input) => {
    const workspace = await window.oxe.workspace.updateEditorState(input)
    set(withSaved(workspace))
  },

  updateReviewState: (input) => savePanelState(set, () => window.oxe.workspace.updateReviewState(input)),

  updateGitHubState: (input) => savePanelState(set, () => window.oxe.workspace.updateGitHubState(input)),

  showRepositoryView: async (workspaceId, view) => {
    const previous = get().workspaces.find((item) => item.id === workspaceId)
    const git = view === 'git'
    // No such workspace, or it already shows that view alone.
    if (!previous || !!previous.githubPanelVisible === git && !!previous.editorVisible === !git) return
    // The panel that opens takes the width of the one that closes (48% when it had none).
    const editor = { editorVisible: !git, editorExpanded: false, ...(!git && { editorWidthPercent: previous.githubPanelWidthPercent ?? 48 }) }
    const github = { githubPanelVisible: git, githubPanelExpanded: false, ...(git && { githubPanelWidthPercent: previous.editorWidthPercent ?? 48 }) }
    const change: Partial<Workspace> = { ...editor, ...github }
    const patch = (next: Partial<Workspace>, error: string | null = null): void =>
      set((state) => ({ workspaces: state.workspaces.map((item) => (item.id === workspaceId ? { ...item, ...next } : item)), error }))
    // One update: the dock never sees both panels hidden, so terminals do not refit in between.
    patch(change)
    const saveEditor = () => window.oxe.workspace.updateEditorState({ workspaceId, ...editor })
    const saveGitHub = () => window.oxe.workspace.updateGitHubState({ workspaceId, ...github })
    try {
      // Persist in turn; only the last answer holds both changes, so the store takes that one alone.
      const saved = git ? (await saveGitHub(), await saveEditor()) : (await saveEditor(), await saveGitHub())
      set((state) => ({ workspaces: replaced(state.workspaces, saved) }))
    } catch (err) {
      // Undo only the fields this switch touched, so a concurrent change to the workspace survives.
      patch(Object.fromEntries(Object.keys(change).map((key) => [key, previous[key as keyof Workspace]])), humanizeError(err, i18n.t('failures.workspace.panelState')))
    }
  },

  updateBackgroundState: (input) => savePanelState(set, () => window.oxe.workspace.updateBackgroundState(input)),

  updateWorktreeState: (input) => savePanelState(set, () => window.oxe.workspace.updateWorktreeState(input)),

  reorderWorkspaces: async (orderedIds) => {
    // Optimistic update — reorder the local cache immediately so the
    // sidebar doesn't flash back to the old order while the IPC roundtrips.
    // The IPC response replaces the cache so any concurrent writes (e.g.
    // a workspace being added during the drag) reconcile correctly.
    const previous = get().workspaces
    const indexById = new Map(orderedIds.map((id, index) => [id, index]))
    const optimistic = [...previous].sort((a, b) => {
      const ai = indexById.get(a.id) ?? Number.MAX_SAFE_INTEGER
      const bi = indexById.get(b.id) ?? Number.MAX_SAFE_INTEGER
      return ai - bi
    })
    set({ workspaces: optimistic, error: null })
    try {
      const fresh = await window.oxe.workspace.reorder(orderedIds)
      set({ workspaces: fresh, error: null })
    } catch (err) {
      // Roll back on failure so the UI doesn't lie about persistence.
      set({ workspaces: previous, error: humanizeError(err, i18n.t('failures.workspace.reorder')) })
    }
  },

  updateSettings: async (input) => {
    // Name, theme, density and layout change at once; the saved workspace replaces the guess when it comes back.
    const { workspaceId, applyShellToIdlePanes: _applyToIdlePanes, ...change } = input
    const previous = get().workspaces.find((item) => item.id === workspaceId)
    const patch = (state: WorkspaceState, next: Partial<Workspace>): Partial<WorkspaceState> => ({
      workspaces: state.workspaces.map((item) => (item.id === workspaceId ? { ...item, ...next } : item))
    })
    await optimistic(set, get, (state) => ({ ...patch(state, change), error: null }), () => window.oxe.workspace.updateSettings(input), {
      rollbackMessage: i18n.t('code:workspace.settingsFailed'),
      reconcile: (workspace, state) => ({ workspaces: replaced(state.workspaces, workspace) }),
      // Undo only the fields this change touched, so a concurrent update to the same workspace survives.
      revert: (state) => previous ? patch(state, Object.fromEntries(Object.keys(change).map((key) => [key, previous[key as keyof Workspace]]))) : {}
    })
  },

  clearError: () => set({ error: null })
}))

export function selectActiveWorkspace(state: WorkspaceState): Workspace | null {
  return state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? null
}

function toMessage(error: unknown): string {
  return humanizeError(error, i18n.t('failures.unexpected.workspace'))
}
