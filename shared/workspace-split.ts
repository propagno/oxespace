import type { WorkspaceLayout } from './types/workspace'

/** The next preset when a split runs past the last column (vertical) or the last row (horizontal). */
export const LAYOUT_UPGRADE_VERTICAL: Partial<Record<WorkspaceLayout, WorkspaceLayout>> = {
  '1x1': '1x2',
  '2x1': '2x2',
  '2x2': '2x3',
  '2x3': '2x4',
  '2x4': '2x5',
  '2x5': '2x7'
}

export const LAYOUT_UPGRADE_HORIZONTAL: Partial<Record<WorkspaceLayout, WorkspaceLayout>> = {
  '1x1': '2x1',
  '1x2': '2x2',
  '2x2': '3x4',
  '3x4': '4x4'
}

export type SplitPlan =
  | { ok: true; layout: WorkspaceLayout; rowIndex: number; columnIndex: number }
  | { ok: false; reason: 'occupied' | 'limit' }

/**
 * Where a split of the classic grid puts the new pane, and the layout it leaves: right of the pane (vertical) or
 * below it (horizontal), growing to the next preset when that runs past the grid. One rule for the main process
 * and for the e2e mock, so the tests see the refusals people see.
 */
export function planSplit(
  layout: WorkspaceLayout,
  panes: ReadonlyArray<{ rowIndex: number; columnIndex: number }>,
  pane: { rowIndex: number; columnIndex: number },
  direction: 'vertical' | 'horizontal'
): SplitPlan {
  const [rows, columns] = layout.split('x').map(Number)
  const rowIndex = direction === 'horizontal' ? pane.rowIndex + 1 : pane.rowIndex
  const columnIndex = direction === 'vertical' ? pane.columnIndex + 1 : pane.columnIndex
  if (panes.some(p => p.rowIndex === rowIndex && p.columnIndex === columnIndex)) return { ok: false, reason: 'occupied' }
  let next: WorkspaceLayout | undefined = layout
  if (direction === 'vertical' && columnIndex >= columns) next = LAYOUT_UPGRADE_VERTICAL[layout]
  else if (direction === 'horizontal' && rowIndex >= rows) next = LAYOUT_UPGRADE_HORIZONTAL[layout]
  if (!next) return { ok: false, reason: 'limit' }
  return { ok: true, layout: next, rowIndex, columnIndex }
}
