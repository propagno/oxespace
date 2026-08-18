/**
 * How many terminal panes may stay rendered at once.
 *
 * The real constraint is WebGL contexts, not workspaces: Chromium drops the
 * oldest context past a per-process limit, and a pane that loses its context
 * falls back to xterm's DOM renderer, which repaints every visible row each
 * frame and degrades badly with large scrollback. Budgeting by workspace count
 * got this wrong in both directions — five single-pane workspaces (5 contexts)
 * were evicted while three four-pane workspaces (12 contexts) were not.
 *
 * Note this budget governs only how many panes are *rendered*. Shell processes
 * are owned by the main process and keep running while detached, so evicting a
 * workspace from the mounted set no longer costs a respawn.
 */
export const MAX_WEBGL_CONTEXTS = 14

/** Two contexts held back for panes being split or dragged mid-interaction. */
export const MAX_MOUNTED_TERMINAL_PANES = 12

/**
 * Trim `orderedWorkspaceIds` (least-recently-visited first) until the mounted
 * terminal panes fit the budget.
 *
 * The active workspace is never evicted, even when it alone exceeds the budget:
 * a DOM-renderer fallback is bad, but unmounting the pane the user is looking
 * at is worse.
 */
export function selectWorkspacesToEvict(
  orderedWorkspaceIds: readonly string[],
  paneCountOf: (workspaceId: string) => number,
  activeWorkspaceId: string | null,
  userCap: number,
  paneBudget = MAX_MOUNTED_TERMINAL_PANES
): string[] {
  const evicted: string[] = []
  const survivors = [...orderedWorkspaceIds]

  const totalPanes = (): number =>
    survivors.reduce((sum, id) => sum + paneCountOf(id), 0)

  // Oldest first; stop as soon as both limits are satisfied.
  while (survivors.length > 0 && (survivors.length > userCap || totalPanes() > paneBudget)) {
    const candidateIndex = survivors.findIndex((id) => id !== activeWorkspaceId)
    if (candidateIndex === -1) break
    const [id] = survivors.splice(candidateIndex, 1)
    if (id !== undefined) evicted.push(id)
  }

  return evicted
}
