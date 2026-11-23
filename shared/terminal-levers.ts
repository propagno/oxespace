/**
 * OXE-411 · The levers measured against the cost of the terminal under load (e2e/perf/terminal-load-breakdown.spec.ts,
 * docs/validation/terminal-load-breakdown.md). H and Q are on by default since 1.6.0 (the user's decision, 23/11);
 * OXESPACE_TERM_LEVERS replaces the default with exactly the levers it names (a comma list, e.g. "H,Q,M"), and
 * OXESPACE_TERM_LEVERS=none turns every lever off, the terminal as it was before the card. M and I stay off unless named.
 *  - H: a pane in a hidden workspace detaches from main (no IPC, no xterm writes, no agent preview scans) and attaches
 *    again, from the retained output, when its workspace shows (src/components/Terminal/TerminalView.tsx).
 *  - M: main's headless screen mirror (agent state) is fed only for panes started as an agent
 *    (electron/main/services/terminal.service.ts).
 *  - I: main batches PTY output to the window in 50 ms or 256 KiB instead of 16 ms or 32 KiB.
 *  - Q: the renderer's write scheduler keeps pending output as a queue of chunks instead of one string it re-copies on
 *    every frame (src/components/Terminal/terminalWriteScheduler.ts).
 */
export type TerminalLever = 'H' | 'M' | 'I' | 'Q'

export const TERMINAL_LEVERS_ENV = 'OXESPACE_TERM_LEVERS'
/** The renderer's copy: main passes the list as this argument, since a sandboxed preload has no environment. */
export const TERMINAL_LEVERS_ARG = '--oxe-term-levers='

export const LEVER_I_FLUSH_MS = 50
export const LEVER_I_FLUSH_BYTES = 256 * 1024

/** The levers when OXESPACE_TERM_LEVERS is unset: the two the measurement recommends. */
export const DEFAULT_TERMINAL_LEVERS: readonly TerminalLever[] = ['H', 'Q']

export function terminalLevers(value: string | undefined | null): ReadonlySet<TerminalLever> {
  if (value === undefined || value === null || value.trim() === '') return new Set(DEFAULT_TERMINAL_LEVERS)
  const levers = new Set<TerminalLever>()
  for (const part of (value ?? '').split(',')) {
    const lever = part.trim().toUpperCase()
    if (lever === 'H' || lever === 'M' || lever === 'I' || lever === 'Q') levers.add(lever)
  }
  return levers
}
