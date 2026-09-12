import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  buildTreeFromPanes,
  computeLayout,
  isValidPaneTree,
  balanceTree,
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
  sync: (workspaceId: string, panes: WorkspacePane[], viewport?: { width: number; height: number }) => void
  balance: (workspaceId: string) => void
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
      balance: (workspaceId) => set(state => ({ trees: { ...state.trees, [workspaceId]: balanceTree(state.trees[workspaceId] ?? null) } })),

      sync: (workspaceId, panes, viewport = { width: 1200, height: 800 }) =>
        set((state) => {
          panes = panes.filter(p => p.rowIndex >= 0 && p.columnIndex >= 0)
          const ids = panes.map((p) => p.id)
          const stored = state.trees[workspaceId]
          const existing = isValidPaneTree(stored) ? stored : buildTreeFromPanes(panes.filter(p => !p.originPaneId))
          if (existing) {
            const treeIds = collectPaneIds(existing)
            const sameSet = treeIds.length === ids.length && treeIds.every((id) => ids.includes(id))
            if (sameSet) return stored === existing ? state : { trees: { ...state.trees, [workspaceId]: existing } }
            let next: PaneNode | null = existing
            for (const id of treeIds) if (!ids.includes(id)) next = removeLeaf(next, id)
            const present = new Set(collectPaneIds(next))
            for (const p of panes) {
              if (!present.has(p.id)) {
                const rects = computeLayout(next).rects
                const target = rects.find(r => r.paneId === p.originPaneId) ?? rects.sort((a, b) => b.width * b.height - a.width * a.height)[0]
                next = target ? splitLeaf(next, target.paneId, p.id, target.width * viewport.width >= target.height * viewport.height ? 'horizontal' : 'vertical') : { kind: 'leaf', paneId: p.id }
                present.add(p.id)
              }
            }
            return { trees: { ...state.trees, [workspaceId]: normalize(next) } }
          }
          return { trees: { ...state.trees, [workspaceId]: buildTreeFromPanes(panes) } }
        }),

      split: (workspaceId, targetPaneId, newPaneId, direction) =>
        set((state) => {
          const tree = state.trees[workspaceId] ?? ({ kind: 'leaf', paneId: targetPaneId } as PaneNode)
          const next = collectPaneIds(tree).includes(newPaneId)
            ? moveLeaf(tree, newPaneId, targetPaneId, direction)
            : normalize(splitLeaf(tree, targetPaneId, newPaneId, direction))
          return { trees: { ...state.trees, [workspaceId]: next } }
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
