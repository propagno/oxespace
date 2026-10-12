/**
 * Legal transitions for a tool call's state.
 *
 * Providers report a tool call more than once (start, progress, result) and the
 * reports can arrive out of order — a delayed "running" after the result, or a
 * replayed start after recovery. A call that has reached a terminal state must
 * never be revived by a late report, and an `unknown` call (turn ended without a
 * result) may still learn its real outcome.
 */
export type ToolCallState = 'running' | 'completed' | 'failed' | 'unknown'

const TERMINAL: ReadonlySet<ToolCallState> = new Set(['completed', 'failed'])

export function isTerminalToolState(state: ToolCallState): boolean {
  return TERMINAL.has(state)
}

/** The state to keep when `incoming` is reported for a call currently in `current`. */
export function nextToolState(current: ToolCallState, incoming: ToolCallState): ToolCallState {
  if (isTerminalToolState(current)) return current
  // A late "running" must not undo an "unknown" settlement either: the turn is over.
  if (current === 'unknown' && incoming === 'running') return current
  return incoming
}
