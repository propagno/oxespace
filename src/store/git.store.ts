import { create } from 'zustand'
import type { GitDiff, GitDiffFile } from '../../shared/types/git'

export type DiffMode = 'unified' | 'side-by-side'

interface WorkspaceGitState {
  diff: GitDiff | null
  isLoading: boolean
  error: string | null
  base: string
  includeUncommitted: boolean
  reviewedFiles: string[]
  selectedFile: string | null
  treeMode: 'structured' | 'flat'
  /** Diff render mode — added in Wave 5 to match Codex Desktop's split-view toggle. */
  diffMode: DiffMode
  sortBy: 'last-edit' | 'name'
  search: string
  /** Hide files the user already ticked "Reviewed". */
  hideReviewed: boolean
  /** Collapsed directory paths in the tree. Persistent across selection. */
  collapsedDirs: string[]
}

interface GitStoreState {
  byWorkspaceId: Record<string, WorkspaceGitState>
  loadDiff(workspaceId: string, rootPath: string): Promise<void>
  subscribeToUpdates(workspaceId: string): () => void
  setBase(workspaceId: string, base: string): void
  setIncludeUncommitted(workspaceId: string, value: boolean): void
  toggleReviewed(workspaceId: string, filePath: string): void
  clearReviewed(workspaceId: string): void
  setHideReviewed(workspaceId: string, value: boolean): void
  selectFile(workspaceId: string, filePath: string | null): void
  setTreeMode(workspaceId: string, mode: 'structured' | 'flat'): void
  setDiffMode(workspaceId: string, mode: DiffMode): void
  toggleDirCollapsed(workspaceId: string, dir: string): void
  setSortBy(workspaceId: string, sortBy: 'last-edit' | 'name'): void
  setSearch(workspaceId: string, query: string): void
}

const DEFAULT_STATE: WorkspaceGitState = {
  diff: null,
  isLoading: false,
  error: null,
  base: 'origin/main',
  includeUncommitted: true,
  reviewedFiles: [],
  selectedFile: null,
  treeMode: 'structured',
  diffMode: 'unified',
  sortBy: 'last-edit',
  search: '',
  hideReviewed: false,
  collapsedDirs: []
}

function patch(
  set: (fn: (s: GitStoreState) => GitStoreState) => void,
  workspaceId: string,
  update: Partial<WorkspaceGitState>
): void {
  set((state) => ({
    ...state,
    byWorkspaceId: {
      ...state.byWorkspaceId,
      [workspaceId]: { ...(state.byWorkspaceId[workspaceId] ?? DEFAULT_STATE), ...update }
    }
  }))
}

export const useGitStore = create<GitStoreState>((set, get) => ({
  byWorkspaceId: {},

  loadDiff: async (workspaceId, rootPath) => {
    const ws = get().byWorkspaceId[workspaceId] ?? DEFAULT_STATE
    patch(set, workspaceId, { isLoading: true, error: null })
    try {
      const diff = await window.oxe.git.getDiff({
        workspaceId,
        rootPath,
        base: ws.base,
        includeUncommitted: ws.includeUncommitted
      })
      patch(set, workspaceId, { diff, isLoading: false, error: null })
    } catch (error) {
      patch(set, workspaceId, { isLoading: false, error: toMessage(error) })
    }
  },

  subscribeToUpdates: (workspaceId) =>
    window.oxe.git.onDiffUpdate((diff) => {
      patch(set, workspaceId, { diff, error: null })
    }),

  setBase: (workspaceId, base) => patch(set, workspaceId, { base }),
  setIncludeUncommitted: (workspaceId, value) => patch(set, workspaceId, { includeUncommitted: value }),
  toggleReviewed: (workspaceId, filePath) => {
    const ws = get().byWorkspaceId[workspaceId] ?? DEFAULT_STATE
    const reviewed = ws.reviewedFiles.includes(filePath)
      ? ws.reviewedFiles.filter((p) => p !== filePath)
      : [...ws.reviewedFiles, filePath]
    patch(set, workspaceId, { reviewedFiles: reviewed })
  },
  clearReviewed: (workspaceId) => patch(set, workspaceId, { reviewedFiles: [] }),
  setHideReviewed: (workspaceId, value) => patch(set, workspaceId, { hideReviewed: value }),
  selectFile: (workspaceId, filePath) => patch(set, workspaceId, { selectedFile: filePath }),
  setTreeMode: (workspaceId, mode) => patch(set, workspaceId, { treeMode: mode }),
  setDiffMode: (workspaceId, mode) => patch(set, workspaceId, { diffMode: mode }),
  toggleDirCollapsed: (workspaceId, dir) => {
    const ws = get().byWorkspaceId[workspaceId] ?? DEFAULT_STATE
    const collapsed = ws.collapsedDirs.includes(dir)
      ? ws.collapsedDirs.filter((d) => d !== dir)
      : [...ws.collapsedDirs, dir]
    patch(set, workspaceId, { collapsedDirs: collapsed })
  },
  setSortBy: (workspaceId, sortBy) => patch(set, workspaceId, { sortBy }),
  setSearch: (workspaceId, query) => patch(set, workspaceId, { search: query })
}))

export function selectGitState(workspaceId: string) {
  return (state: GitStoreState): WorkspaceGitState =>
    state.byWorkspaceId[workspaceId] ?? DEFAULT_STATE
}

// (selectFilteredFiles was removed — the filtering+sorting that used to live
// here as a Zustand selector created a fresh array on every call, which under
// React 19 + useSyncExternalStore could enter a runaway re-render loop. The
// logic now runs inside ReviewPane via useMemo, scoped to the slices it
// actually depends on.)

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected git error'
}
