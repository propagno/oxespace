import type { GitDiff } from '../../../shared/types/git'
import type { ThreadPlace, ThreadPlaceDiff, ThreadPlaceDrift, ThreadPlaceDriftAnswer, ThreadPlaceKind, ThreadPlaces, ThreadPlaceWrite } from '../../../shared/types/thread-places'

/** U4.1: the order the places read in, top to bottom. */
export const PLACE_ORDER: readonly ThreadPlaceKind[] = ['worktree', 'root', 'checkout', 'outside']

/** Places in display order; within a kind, the order main gave. */
export function orderPlaces(places: readonly ThreadPlace[]): ThreadPlace[] {
  return places
    .map((place, index) => ({ place, index }))
    .sort((a, b) => (PLACE_ORDER.indexOf(a.place.kind) - PLACE_ORDER.indexOf(b.place.kind)) || (a.index - b.index))
    .map(entry => entry.place)
}

/** U4.2: a drift card shows while main reports the drift without an answer. */
export function showsDriftCard(place: ThreadPlace): boolean {
  return Boolean(place.drift && !place.drift.answer)
}

export type PlaceUndoResult = { ok: true; restoreToken: string } | { ok: false; refusal: { code: string; params?: Record<string, unknown> } }

/** The place calls on the window bridge (BACKEND #704). */
export interface PlacesBridge {
  places?(threadId: string): Promise<ThreadPlaces>
  placeDiff?(threadId: string, placeId: string): Promise<ThreadPlaceDiff>
  placeDriftAnswer?(threadId: string, placeId: string, answer: ThreadPlaceDriftAnswer): Promise<{ ok: boolean; place?: ThreadPlace }>
  placeUndo?(threadId: string, placeId: string, input: { path: string; hunk?: string; seenMtime: number }): Promise<PlaceUndoResult>
  placeRestore?(threadId: string, restoreToken: string): Promise<{ ok: boolean }>
  placeDiscard?(threadId: string, placeId: string, input: { confirmed: boolean }): Promise<{ ok: boolean }>
  onPlacesChanged?(listener: (event: { threadId: string }) => void): () => void
  collisions?(threadId: string): Promise<Array<{ file: string; others: Array<{ conversationId: string; title: string }> }> | null | undefined>
}

export function placesBridge(): PlacesBridge | undefined {
  return (window as unknown as { oxe?: { thread?: PlacesBridge } }).oxe?.thread
}

/** The task and branch-switch groups of a git place, or the written list of an outside one. */
export type PlaceGroups =
  | { kind: 'git'; task: GitDiff; branchSwitch: GitDiff | null }
  | { kind: 'written'; written: ThreadPlaceWrite[] }

export function placeGroups(diff: ThreadPlaceDiff | null | undefined): PlaceGroups | null {
  if (!diff) return null
  const groups = diff.groups
  if ('written' in groups) return { kind: 'written', written: groups.written }
  return { kind: 'git', task: groups.task, branchSwitch: groups.branchSwitch ?? null }
}

/** Files a place's groups name, for the summary count. */
export function groupFileCount(groups: PlaceGroups | null): number {
  if (!groups) return 0
  if (groups.kind === 'written') return groups.written.length
  return groups.task.files.length
}

/** "14:31": the drift time in the person's 24-hour clock, the same on every machine. */
export function clockTime(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Which pane hint the drift sentence uses: none, one named terminal, or a list. */
export type DriftPaneHint = { kind: 'none' } | { kind: 'one'; title: string; paneId: string } | { kind: 'many'; titles: string }

export function driftPaneHint(drift: ThreadPlaceDrift): DriftPaneHint {
  const panes = drift.by.filter(entry => entry.kind === 'pane')
  if (panes.length === 0) return { kind: 'none' }
  if (panes.length === 1) return { kind: 'one', title: panes[0].title, paneId: panes[0].id }
  return { kind: 'many', titles: panes.map(pane => pane.title).join(', ') }
}

/** Why Switch back cannot run, if it cannot: an i18n key under thread.places.drift. */
export function switchBackBlock(drift: ThreadPlaceDrift, running: boolean): 'dirty' | 'detached' | 'busy' | null {
  if (drift.detached || !drift.from.branch) return 'detached'
  if (drift.dirty) return 'dirty'
  if (running) return 'busy'
  return null
}

/** D1/D4: the files, lines and places with changes, for the summary line. A place not read yet counts nothing. */
export interface PlacesStats { files: number; additions: number; deletions: number; places: number }
export function placesStats(groups: ReadonlyArray<PlaceGroups | null | undefined>): PlacesStats {
  const stats: PlacesStats = { files: 0, additions: 0, deletions: 0, places: 0 }
  for (const group of groups) {
    if (!group) continue
    const counts = group.kind === 'written'
      ? group.written.map(file => [file.additions ?? 0, file.deletions ?? 0] as const)
      : group.task.files.map(file => [file.additions, file.deletions] as const)
    if (counts.length === 0) continue
    stats.places += 1
    stats.files += counts.length
    for (const [additions, deletions] of counts) { stats.additions += additions; stats.deletions += deletions }
  }
  return stats
}

/** D1: the first line of a hunk on the new side ("@@ -10,4 +10,6 @@" is 10); a new file starts at 1. */
export function hunkLine(header: string): number {
  const match = /\+(\d+)/.exec(header)
  const line = match ? Number(match[1]) : 1
  return line > 0 ? line : 1
}

/** D2: a long path cut in the middle (keeps its first and last segments), so the header stays one line; the full path goes in the tooltip. */
export function middlePath(path: string, max = 48): string {
  if (path.length <= max) return path
  const sep = path.includes('\\') && !path.includes('/') ? '\\' : '/'
  const parts = path.split(sep)
  const last = parts.length > 1 ? `${sep}${parts[parts.length - 1]}` : ''
  const keep = Math.max(1, max - last.length - 1)
  return `${path.slice(0, keep)}…${last}`
}

/** The short base commit the place diffs against. */
export function shortCommit(commit: string | null | undefined): string {
  return commit ? commit.slice(0, 7) : ''
}
