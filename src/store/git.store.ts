import { create } from 'zustand'
import type { GitDiff, GitDiffFile } from '../../shared/types/git'

interface WorkspaceGitState {
  diff: GitDiff | null
  isLoading: boolean
  error: string | null
  base: string
  includeUncommitted: boolean
  readFiles: string[]
  selectedFile: string | null
  viewMode: 'structured' | 'flat'
  sortBy: 'last-edit' | 'name'
  search: string
}

interface GitStoreState {
  byWorkspaceId: Record<string, WorkspaceGitState>
  loadDiff(workspaceId: string, rootPath: string): Promise<void>
  subscribeToUpdates(workspaceId: string): () => void
  setBase(workspaceId: string, base: string): void
  setIncludeUncommitted(workspaceId: string, value: boolean): void
  markRead(workspaceId: string, filePath: string): void
  selectFile(workspaceId: string, filePath: string | null): void
  setViewMode(workspaceId: string, mode: 'structured' | 'flat'): void
  setSortBy(workspaceId: string, sortBy: 'last-edit' | 'name'): void
  setSearch(workspaceId: string, query: string): void
}

const DEFAULT_STATE: WorkspaceGitState = {
  diff: null,
  isLoading: false,
  error: null,
  base: 'origin/main',
  includeUncommitted: true,
  readFiles: [],
  selectedFile: null,
  viewMode: 'structured',
  sortBy: 'last-edit',
  search: ''
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
  markRead: (workspaceId, filePath) => {
    const ws = get().byWorkspaceId[workspaceId] ?? DEFAULT_STATE
    if (!ws.readFiles.includes(filePath)) {
      patch(set, workspaceId, { readFiles: [...ws.readFiles, filePath] })
    }
  },
  selectFile: (workspaceId, filePath) => patch(set, workspaceId, { selectedFile: filePath }),
  setViewMode: (workspaceId, mode) => patch(set, workspaceId, { viewMode: mode }),
  setSortBy: (workspaceId, sortBy) => patch(set, workspaceId, { sortBy }),
  setSearch: (workspaceId, query) => patch(set, workspaceId, { search: query })
}))

export function selectGitState(workspaceId: string) {
  return (state: GitStoreState): WorkspaceGitState =>
    state.byWorkspaceId[workspaceId] ?? DEFAULT_STATE
}

export function selectFilteredFiles(workspaceId: string, readFilter?: boolean) {
  return (state: GitStoreState): GitDiffFile[] => {
    const ws = state.byWorkspaceId[workspaceId] ?? DEFAULT_STATE
    if (!ws.diff) return []
    let files = ws.diff.files
    if (ws.search) {
      const q = ws.search.toLowerCase()
      files = files.filter((f) => f.path.toLowerCase().includes(q))
    }
    if (readFilter) {
      files = files.filter((f) => !ws.readFiles.includes(f.path))
    }
    if (ws.sortBy === 'name') {
      files = [...files].sort((a, b) => a.path.localeCompare(b.path))
    } else {
      files = [...files].sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
    }
    return files
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected git error'
}
