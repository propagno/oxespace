import type { SizeLeases } from './size-lease'

type Size = { cols: number; rows: number }

/**
 * OXE-52 (T18-b) · A phone's held size is never the desktop's: a pane restarted while a phone holds it starts at the
 * desktop's own fit. A pane nobody holds restarts as it last started (`last`).
 */
export function desktopStartSize(sizes: Pick<SizeLeases, 'desktopSize'>, paneId: string, last: Size): Size {
  const desktop = sizes.desktopSize(paneId)
  return desktop ? { cols: desktop.cols, rows: desktop.rows } : { cols: last.cols, rows: last.rows }
}

/**
 * OXE-52 (T18-b) · A pane that exits while a phone holds it keeps the desktop's size for its next start, not the
 * phone's. Call before the hold is forgotten; a pane nobody holds is left as it is.
 */
export function keepDesktopSize(sizes: Pick<SizeLeases, 'desktopSize'>, paneId: string, session: Size | undefined): void {
  if (!session) return
  const desktop = sizes.desktopSize(paneId)
  if (!desktop) return
  session.cols = desktop.cols
  session.rows = desktop.rows
}
