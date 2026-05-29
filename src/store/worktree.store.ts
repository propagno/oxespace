import { create } from 'zustand'
import type { GitHubWorktree } from '../../shared/types/github'

interface WorktreeStoreState {
  /** Worktrees keyed by workspace rootPath (the main worktree's path). */
  byRoot: Record<string, GitHubWorktree[]>
  loading: Record<string, boolean>
  error: Record<string, string | null>
  refresh: (workspaceId: string, rootPath: string) => Promise<void>
  create: (rootPath: string, branch: string, path: string, createBranch?: boolean) => Promise<void>
  remove: (rootPath: string, path: string, force?: boolean) => Promise<void>
}

export const useWorktreeStore = create<WorktreeStoreState>((set, get) => ({
  byRoot: {},
  loading: {},
  error: {},

  refresh: async (workspaceId, rootPath) => {
    set((s) => ({ loading: { ...s.loading, [rootPath]: true } }))
    try {
      const worktrees = await window.oxe.github.listWorktrees({ workspaceId, rootPath })
      set((s) => ({
        byRoot: { ...s.byRoot, [rootPath]: worktrees },
        loading: { ...s.loading, [rootPath]: false },
        error: { ...s.error, [rootPath]: null }
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set((s) => ({
        loading: { ...s.loading, [rootPath]: false },
        error: { ...s.error, [rootPath]: message }
      }))
    }
  },

  create: async (rootPath, branch, path, createBranch = false) => {
    await window.oxe.github.createWorktree({ rootPath, branch, path, createBranch })
    // Need workspaceId for the refresh but we can call list without it
    const worktrees = await window.oxe.github.listWorktrees({ workspaceId: '', rootPath })
    set((s) => ({ byRoot: { ...s.byRoot, [rootPath]: worktrees } }))
  },

  remove: async (rootPath, path, force = false) => {
    // `git worktree remove` can de-register the worktree yet still fail (non-zero
    // exit) when the OS refuses to delete the folder — on Windows that happens
    // when a pane's shell still holds the directory as its cwd. Refresh the list
    // in `finally` so the UI reflects git's actual state even on a partial
    // failure, then re-throw so the caller can surface a helpful message.
    try {
      await window.oxe.github.removeWorktree({ rootPath, path, force })
    } finally {
      const worktrees = await window.oxe.github.listWorktrees({ workspaceId: '', rootPath }).catch(() => null)
      if (worktrees) set((s) => ({ byRoot: { ...s.byRoot, [rootPath]: worktrees } }))
    }
  }
}))

export function selectWorktrees(rootPath: string): (state: WorktreeStoreState) => GitHubWorktree[] {
  return (state) => state.byRoot[rootPath] ?? []
}
