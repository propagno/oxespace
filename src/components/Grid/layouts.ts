import type { WorkspaceLayout, WorkspacePane } from '../../../shared/types/workspace'

export interface LayoutDefinition {
  rows: number
  columns: number
}

export const LAYOUTS: Record<WorkspaceLayout, LayoutDefinition> = {
  '1x1': { rows: 1, columns: 1 },
  '1x2': { rows: 1, columns: 2 },
  '2x1': { rows: 2, columns: 1 },
  '2x2': { rows: 2, columns: 2 },
  '2x3': { rows: 2, columns: 3 },
  '2x4': { rows: 2, columns: 4 },
  '2x5': { rows: 2, columns: 5 },
  '2x7': { rows: 2, columns: 7 },
  '3x4': { rows: 3, columns: 4 },
  '4x4': { rows: 4, columns: 4 }
}

export function getPaneAt(panes: WorkspacePane[], rowIndex: number, columnIndex: number): WorkspacePane | null {
  return panes.find((pane) => pane.rowIndex === rowIndex && pane.columnIndex === columnIndex) ?? null
}
