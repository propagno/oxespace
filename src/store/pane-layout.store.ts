import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  buildTreeFromPanes,
  computeLayout,
  isValidPaneTree,
  balanceTree,
  collectPaneIds,
  moveLeaf,
  placeSplit,
  normalize,
  removeLeaf,
  resizeSplit,
  splitLeaf,
  type PaneNode,
  type SplitDirection
} from '../../shared/types/pane-tree'
import type { WorkspacePane } from '../../shared/types/workspace'

interface PendingSplit {
  targetPaneId: string
  direction: SplitDirection
}

// Non-persisted reservations so `sync()` places a newly created pane directly in the
// user's requested split direction on frame 1 instead of laying out in an intermediate
// aspect-ratio heuristic direction first (OXE-471).
const pendingSplits = new Map<string, PendingSplit[]>()

function takeReservedSplit(workspaceId: string, present: Set<string>): PendingSplit | null {
  const queue = pendingSplits.get(workspaceId)
  if (!queue || queue.length === 0) return null
  const idx = queue.findIndex((entry) => present.has(entry.targetPaneId))
  if (idx === -1) return null
  const [matched] = queue.splice(idx, 1)
  if (queue.length === 0) pendingSplits.delete(workspaceId)
  return matched
}

function consumeExactReservedSplit(workspaceId: string, targetPaneId: string, direction: SplitDirection): void {
  const queue = pendingSplits.get(workspaceId)
  if (!queue || queue.length === 0) return
  const idx = queue.findIndex((entry) => entry.targetPaneId === targetPaneId && entry.direction === direction)
  if (idx === -1) return
  queue.splice(idx, 1)
  if (queue.length === 0) pendingSplits.delete(workspaceId)
}

function isAlreadySplitBeside(
  node: PaneNode | null,
  targetPaneId: string,
  newPaneId: string,
  direction: SplitDirection
): boolean {
  if (!node || node.kind === 'leaf') return false
  if (node.direction === direction) {
    const sizes = node.sizes
    for (let i = 0; i < node.children.length - 1; i++) {
      const a = node.children[i]
      const b = node.children[i + 1]
      if (a.kind === 'leaf' && a.paneId === targetPaneId && b.kind === 'leaf' && b.paneId === newPaneId) {
        if (!sizes || Math.abs(sizes[i] - sizes[i + 1]) < 1e-3) return true
      }
    }
  }
  return node.children.some((child) => isAlreadySplitBeside(child, targetPaneId, newPaneId, direction))
}

interface PaneLayoutState {
  /** Split-tree per workspace (F2). Persisted to localStorage. */
  trees: Record<string, PaneNode | null>
  /** Reconcile the tree with the current pane records (add new, drop removed). */
  sync: (workspaceId: string, panes: WorkspacePane[], viewport?: { width: number; height: number }) => void
  /** Rebuild the split tree from grid coordinates after a layout preset switch, preserving all pane IDs. */
  resetFromPanes: (workspaceId: string, panes: WorkspacePane[]) => void
  balance: (workspaceId: string) => void
  /** Reserve the target/direction for an in-flight `createPane` split so `sync` places it directly. */
  reserveSplit: (workspaceId: string, targetPaneId: string, direction: SplitDirection) => void
  /** Clear a reserved split if `createPane` fails before `sync`/`split` consumes it. */
  cancelReservedSplit: (workspaceId: string, targetPaneId: string, direction: SplitDirection) => void
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

      reserveSplit: (workspaceId, targetPaneId, direction) => {
        const queue = pendingSplits.get(workspaceId)
        if (queue) queue.push({ targetPaneId, direction })
        else pendingSplits.set(workspaceId, [{ targetPaneId, direction }])
      },

      cancelReservedSplit: (workspaceId, targetPaneId, direction) => {
        consumeExactReservedSplit(workspaceId, targetPaneId, direction)
      },

      resetFromPanes: (workspaceId, panes) =>
        set((state) => ({
          trees: {
            ...state.trees,
            [workspaceId]: buildTreeFromPanes(panes.filter((p) => p.rowIndex >= 0 && p.columnIndex >= 0))
          }
        })),

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
                const reserved = takeReservedSplit(workspaceId, present)
                if (reserved) {
                  next = splitLeaf(next, reserved.targetPaneId, p.id, reserved.direction)
                } else {
                  const rects = computeLayout(next).rects
                  const target = rects.find(r => r.paneId === p.originPaneId) ?? rects.sort((a, b) => b.width * b.height - a.width * a.height)[0]
                  next = target ? splitLeaf(next, target.paneId, p.id, target.width * viewport.width >= target.height * viewport.height ? 'horizontal' : 'vertical') : { kind: 'leaf', paneId: p.id }
                }
                present.add(p.id)
              }
            }
            return { trees: { ...state.trees, [workspaceId]: normalize(next) } }
          }
          return { trees: { ...state.trees, [workspaceId]: buildTreeFromPanes(panes) } }
        }),

      split: (workspaceId, targetPaneId, newPaneId, direction) =>
        set((state) => {
          consumeExactReservedSplit(workspaceId, targetPaneId, direction)
          const tree = state.trees[workspaceId] ?? ({ kind: 'leaf', paneId: targetPaneId } as PaneNode)
          if (isAlreadySplitBeside(tree, targetPaneId, newPaneId, direction)) return state
          const next = collectPaneIds(tree).includes(newPaneId)
            // `sync` may have placed the new pane already; the two then share what the origin had (placeSplit).
            ? placeSplit(tree, targetPaneId, newPaneId, direction)
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
