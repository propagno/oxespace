import { create } from 'zustand'
import type { GitHubWorktree, GitHubWorktreeStatus } from '../../shared/types/github'

export interface CreateWorktreeOptions {
  createBranch?: boolean
  /** Start point for the new branch (`origin/main`, a tag, a SHA). */
  baseRef?: string
  /** Fetch the remote that owns `baseRef` before creating. */
  fetchBase?: boolean
}

interface WorktreeStoreState {
  /** Worktrees keyed by workspace rootPath (the main worktree's path). */
  byRoot: Record<string, GitHubWorktree[]>
  loading: Record<string, boolean>
  error: Record<string, string | null>
  refresh: (workspaceId: string, rootPath: string) => Promise<void>
  create: (workspaceId: string, rootPath: string, branch: string, path: string, options?: CreateWorktreeOptions) => Promise<void>
  remove: (workspaceId: string, rootPath: string, path: string, force?: boolean) => Promise<void>
  status: (rootPath: string, path: string) => Promise<GitHubWorktreeStatus | null>
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

  create: async (workspaceId, rootPath, branch, path, options = {}) => {
    await window.oxe.github.createWorktree({
      rootPath,
      branch,
      path,
      createBranch: options.createBranch === true,
      baseRef: options.baseRef,
      fetchBase: options.fetchBase === true
    })
    await get().refresh(workspaceId, rootPath)
  },

  remove: async (workspaceId, rootPath, path, force = false) => {
    // `git worktree remove` can de-register the worktree yet still fail (non-zero
    // exit) when the OS refuses to delete the folder — on Windows that happens
    // when a pane's shell still holds the directory as its cwd. Refresh the list
    // in `finally` so the UI reflects git's actual state even on a partial
    // failure, then re-throw so the caller can surface a helpful message.
    try {
      await window.oxe.github.removeWorktree({ rootPath, path, force })
    } finally {
      await get().refresh(workspaceId, rootPath)
    }
  },

  status: async (rootPath, path) => {
    // Best-effort: a status probe that fails must never block the removal flow
    // that asked for it — the caller falls back to git's own refusal message.
    try {
      return await window.oxe.github.getWorktreeStatus({ rootPath, path })
    } catch {
      return null
    }
  }
}))

export function selectWorktrees(rootPath: string): (state: WorktreeStoreState) => GitHubWorktree[] {
  return (state) => state.byRoot[rootPath] ?? []
}
