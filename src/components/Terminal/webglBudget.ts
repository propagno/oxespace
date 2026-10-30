import type { TerminalPresence } from '../../../shared/types/ipc/terminal'

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

/**
 * How many panes may draw with WebGL at once, the focused one first (F16). Each WebGL pane keeps a glyph
 * atlas and framebuffers in the GPU process and composites every frame it draws; with six full-screen
 * agents that was a fifth of a core of GPU time. Panes past the budget draw with xterm's DOM renderer,
 * which repaints only the rows that changed and suits the 100 ms pace of a visible-but-unfocused pane.
 * `localStorage['oxe.terminal.webglPanes']` overrides it, so the bench can compare budgets without a build.
 */
export const WEBGL_PANE_BUDGET = 4

function configuredWebglPaneBudget(): number {
  try {
    const raw = localStorage.getItem('oxe.terminal.webglPanes')
    const value = raw === null ? NaN : Number(raw)
    return Number.isInteger(value) && value >= 0 && value <= MAX_WEBGL_CONTEXTS ? value : WEBGL_PANE_BUDGET
  } catch { return WEBGL_PANE_BUDGET }
}

interface BudgetEntry { presence: TerminalPresence; focusedAt: number; granted: boolean; onChange: (granted: boolean) => void }

/**
 * Hands WebGL to panes by how much the person sees of them: the focused pane always gets it (taking the
 * slot of the visible pane focused longest ago when the budget is full), visible panes take free slots,
 * hidden panes give theirs back. A pane keeps its slot until a focused one needs it, so moving focus
 * between panes that already draw with WebGL switches no renderer.
 */
export class WebglPaneBudget {
  private readonly entries = new Map<string, BudgetEntry>()
  private focusClock = 0

  constructor(private readonly limit: number = configuredWebglPaneBudget()) {}

  /** Registers a pane; `onChange` hears every grant and revoke. Returns the release for unmount. */
  join(paneId: string, presence: TerminalPresence, onChange: (granted: boolean) => void): () => void {
    const entry: BudgetEntry = { presence, focusedAt: presence === 'focused' ? ++this.focusClock : 0, granted: false, onChange }
    this.entries.set(paneId, entry)
    this.rebalance()
    return () => {
      if (this.entries.get(paneId) !== entry) return
      this.entries.delete(paneId)
      if (entry.granted) { entry.granted = false; entry.onChange(false) }
      this.rebalance()
    }
  }

  setPresence(paneId: string, presence: TerminalPresence): void {
    const entry = this.entries.get(paneId)
    if (!entry || entry.presence === presence) return
    entry.presence = presence
    if (presence === 'focused') entry.focusedAt = ++this.focusClock
    this.rebalance()
  }

  granted(paneId: string): boolean {
    return this.entries.get(paneId)?.granted ?? false
  }

  private rebalance(): void {
    const changed: BudgetEntry[] = []
    const set = (entry: BudgetEntry, granted: boolean): void => { entry.granted = granted; changed.push(entry) }
    for (const entry of this.entries.values()) if (entry.granted && entry.presence === 'hidden') set(entry, false)
    let held = [...this.entries.values()].filter(entry => entry.granted).length
    // Focused first, then the most recently focused, so a freed slot goes to the pane the person just left.
    const waiting = [...this.entries.values()]
      .filter(entry => !entry.granted && entry.presence !== 'hidden')
      .sort((a, b) => Number(b.presence === 'focused') - Number(a.presence === 'focused') || b.focusedAt - a.focusedAt)
    for (const entry of waiting) {
      if (held < this.limit) { set(entry, true); held++; continue }
      if (entry.presence !== 'focused') break
      const victim = [...this.entries.values()]
        .filter(other => other.granted && other.presence !== 'focused')
        .sort((a, b) => a.focusedAt - b.focusedAt)[0]
      if (!victim) break
      set(victim, false)
      set(entry, true)
    }
    // Revokes before grants, so a context is given back before the next one is created.
    for (const entry of changed.filter(e => !e.granted)) entry.onChange(false)
    for (const entry of changed.filter(e => e.granted)) entry.onChange(true)
  }
}

export const webglPaneBudget = new WebglPaneBudget()
