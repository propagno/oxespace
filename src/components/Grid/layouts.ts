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

/**
 * The grid of a layout. A layout outside the presets (one a split grew, or one from an older or newer version) is
 * read from its "rows x columns" name; an unreadable one counts as 1 x 1, and the panes' own positions widen it.
 */
export function layoutOf(layout: string): LayoutDefinition {
  const known = (LAYOUTS as Record<string, LayoutDefinition | undefined>)[layout]
  if (known) return known
  const match = /^(\d{1,2})x(\d{1,2})$/.exec(layout)
  const rows = match ? Number(match[1]) : 1
  const columns = match ? Number(match[2]) : 1
  return { rows: Math.max(1, rows), columns: Math.max(1, columns) }
}

export function getPaneAt(panes: WorkspacePane[], rowIndex: number, columnIndex: number): WorkspacePane | null {
  return panes.find((pane) => pane.rowIndex === rowIndex && pane.columnIndex === columnIndex) ?? null
}
