/** 1.5.0 A8 · The eight workspace colors. The stored value is the slot number; the CSS maps a slot to the
 *  --ws-<n> tokens through [data-ws="<n>"] (src/design/workspace-color.css). */
export const WORKSPACE_COLORS = [1, 2, 3, 4, 5, 6, 7, 8] as const

export type WorkspaceColor = typeof WORKSPACE_COLORS[number]

export function isWorkspaceColor(value: unknown): value is WorkspaceColor {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= WORKSPACE_COLORS.length
}

/** The color a workspace shows: the chosen one, or a stable hash of its id (FNV-1a, 32 bit) when none was chosen. */
export function workspaceColorIndex(ws: { id: string; color: number | null }): number {
  if (isWorkspaceColor(ws.color)) return ws.color
  let hash = 0x811c9dc5
  for (let i = 0; i < ws.id.length; i++) {
    hash ^= ws.id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return ((hash >>> 0) % WORKSPACE_COLORS.length) + 1
}

/** The only hook the workspace color CSS reads: spread it on a workspace surface. */
export function workspaceColorAttrs(ws: { id: string; color: number | null }): { 'data-ws': string } {
  return { 'data-ws': String(workspaceColorIndex(ws)) }
}
