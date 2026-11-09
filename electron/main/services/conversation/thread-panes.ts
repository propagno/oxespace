import { isAbsolute } from 'node:path'
import { canonicalPath } from '../git-common-dir'
import type { ThreadPane, ThreadPaneSource, ThreadPaneVia, ThreadPlace } from '../../../../shared/types/thread-places'

/** A path value the pane registry gave: only a non-empty absolute string without NUL counts. */
function usable(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0') && isAbsolute(value)
}

/** The newest known cwd of a pane: the shell's OSC report, else the agent hook's location, else the launch folder. */
function newestCwd(pane: ThreadPaneSource): { cwd: string; via: ThreadPaneVia } | null {
  if (usable(pane.shellCwd)) return { cwd: pane.shellCwd, via: 'shell-osc' }
  if (usable(pane.agentCwd)) return { cwd: pane.agentCwd, via: 'agent-location' }
  if (usable(pane.launchDir)) return { cwd: pane.launchDir, via: 'launch' }
  return null
}

function canonical(path: string): string | null {
  try { return canonicalPath(path) } catch { return null }
}

/** Equal to the place, or under it after a separator: `/x/tree-copy` is never inside `/x/tree`. */
function inside(cwd: string, root: string): boolean {
  if (cwd === root) return true
  return cwd.startsWith(root.endsWith('/') ? root : `${root}/`)
}

/**
 * A18 (ccr-t71-task-places.md §6, the task's Terminal tab): the panes whose newest known cwd is inside one of the
 * task's places, with how that was known and whether an agent runs there. Computed on every request, never stored.
 * A pane in nested places belongs to the deepest one.
 */
export function threadPanes(places: ThreadPlace[], panes: ThreadPaneSource[]): ThreadPane[] {
  const roots: { place: ThreadPlace; root: string }[] = []
  for (const place of places) {
    const root = typeof place.path === 'string' && place.path ? canonical(place.path) : null
    if (root) roots.push({ place, root })
  }
  const result: ThreadPane[] = []
  if (!roots.length) return result
  for (const pane of panes) {
    const newest = newestCwd(pane)
    if (!newest) continue
    const cwd = canonical(newest.cwd)
    if (!cwd) continue
    let best: { place: ThreadPlace; root: string } | null = null
    for (const entry of roots) {
      if (inside(cwd, entry.root) && (!best || entry.root.length > best.root.length)) best = entry
    }
    if (!best) continue
    result.push({ paneId: pane.paneId, title: pane.title, workspaceId: pane.workspaceId, placeId: best.place.id, via: newest.via, group: pane.agent ? 'agent' : 'yours' })
  }
  return result
}
