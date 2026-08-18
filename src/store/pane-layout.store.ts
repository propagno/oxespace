import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  buildTreeFromPanes,
  collectPaneIds,
  moveLeaf,
  normalize,
  removeLeaf,
  resizeSplit,
  splitLeaf,
  type PaneNode,
  type SplitDirection
} from '../../shared/types/pane-tree'
import type { WorkspacePane } from '../../shared/types/workspace'

interface PaneLayoutState {
  /** Split-tree per workspace (F2). Persisted to localStorage. */
  trees: Record<string, PaneNode | null>
  /** Reconcile the tree with the current pane records (add new, drop removed). */
  sync: (workspaceId: string, panes: WorkspacePane[]) => void
  split: (workspaceId: string, targetPaneId: string, newPaneId: string, direction: SplitDirection) => void
  remove: (workspaceId: string, paneId: string) => void
  resize: (workspaceId: string, path: number[], index: number, deltaPct: number) => void
  /** Drag-to-split: relocate `paneId` beside `targetPaneId` along `direction`. */
  move: (workspaceId: string, paneId: string, targetPaneId: string, direction: SplitDirection, after: boolean) => void
}

export const usePaneLayoutStore = create<PaneLayoutState>()(
  persist(
    (set) => ({
      trees: {},

      sync: (workspaceId, panes) =>
        set((state) => {
          const ids = panes.map((p) => p.id)
          const existing = state.trees[workspaceId]
          if (existing) {
            const treeIds = collectPaneIds(existing)
            const sameSet = treeIds.length === ids.length && treeIds.every((id) => ids.includes(id))
            if (sameSet) return state // membership unchanged → keep structure
            let next: PaneNode | null = existing
            for (const id of treeIds) if (!ids.includes(id)) next = removeLeaf(next, id)
            const present = new Set(collectPaneIds(next))
            for (const p of panes) {
              if (!present.has(p.id)) {
                const leaf: PaneNode = { kind: 'leaf', paneId: p.id }
                next = next ? { kind: 'split', direction: 'horizontal', children: [next, leaf] } : leaf
              }
            }
            return { trees: { ...state.trees, [workspaceId]: normalize(next) } }
          }
          return { trees: { ...state.trees, [workspaceId]: buildTreeFromPanes(panes) } }
        }),

      split: (workspaceId, targetPaneId, newPaneId, direction) =>
        set((state) => {
          const tree = state.trees[workspaceId] ?? ({ kind: 'leaf', paneId: targetPaneId } as PaneNode)
          return { trees: { ...state.trees, [workspaceId]: normalize(splitLeaf(tree, targetPaneId, newPaneId, direction)) } }
        }),

      remove: (workspaceId, paneId) =>
        set((state) => ({ trees: { ...state.trees, [workspaceId]: removeLeaf(state.trees[workspaceId] ?? null, paneId) } })),

      resize: (workspaceId, path, index, deltaPct) =>
        set((state) => ({
          trees: { ...state.trees, [workspaceId]: resizeSplit(state.trees[workspaceId] ?? null, path, index, deltaPct) }
        })),

      move: (workspaceId, paneId, targetPaneId, direction, after) =>
        set((state) => ({
          trees: {
            ...state.trees,
            [workspaceId]: moveLeaf(state.trees[workspaceId] ?? null, paneId, targetPaneId, direction, after)
          }
        }))
    }),
    {
      name: 'oxe-pane-layout-trees-v1'
    }
  )
)

