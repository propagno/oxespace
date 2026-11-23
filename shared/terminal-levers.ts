/**
 * OXE-411 · The levers measured against the cost of the terminal under load, each off unless OXESPACE_TERM_LEVERS
 * names it (a comma list, e.g. "H,M,I"). Unset, nothing changes. Measured by e2e/perf/terminal-load-breakdown.spec.ts;
 * the results are in docs/validation/terminal-load-breakdown.md.
 *  - H: a pane in a hidden workspace detaches from main (no IPC, no xterm writes, no agent preview scans) and attaches
 *    again, from the retained output, when its workspace shows (src/components/Terminal/TerminalView.tsx).
 *  - M: main's headless screen mirror (agent state) is fed only for panes started as an agent
 *    (electron/main/services/terminal.service.ts).
 *  - I: main batches PTY output to the window in 50 ms or 256 KiB instead of 16 ms or 32 KiB.
 */
export type TerminalLever = 'H' | 'M' | 'I'

export const TERMINAL_LEVERS_ENV = 'OXESPACE_TERM_LEVERS'
/** The renderer's copy: main passes the list as this argument, since a sandboxed preload has no environment. */
export const TERMINAL_LEVERS_ARG = '--oxe-term-levers='

export const LEVER_I_FLUSH_MS = 50
export const LEVER_I_FLUSH_BYTES = 256 * 1024

export function terminalLevers(value: string | undefined | null): ReadonlySet<TerminalLever> {
  const levers = new Set<TerminalLever>()
  for (const part of (value ?? '').split(',')) {
    const lever = part.trim().toUpperCase()
    if (lever === 'H' || lever === 'M' || lever === 'I') levers.add(lever)
  }
  return levers
}
