/**
 * S7.1 · Where the agents read model hears that a source changed. Each source's existing emitter calls
 * `notifyAgentSource` next to the window broadcast it already sends: pane agent state (`broadcastAgentState`), a
 * conversation (`thread-runtime`), a delegation (`DelegationApplicationService.event`), an Agent Work run
 * (`WorkService.event`) and a B10 approval (`approvalCenter`).
 *
 * Deliberately tiny and dependency-free: the emitters import it statically, so it must cost nothing. Until the read
 * model loads (on the first `agents:*` call) nothing listens and a notify does nothing. No polling anywhere.
 */
export type AgentSourceName = 'pane' | 'conversation' | 'delegation' | 'work' | 'approval'

export interface AgentSourceEvent {
  source: AgentSourceName
  /** The source's id (pane, conversation, delegation, run); absent when the whole source may have changed. */
  id?: string
  /** The source is gone for good (a closed pane's agent, a deleted conversation): its seen mark goes too. */
  deleted?: true
  /** Panes only: the pane itself left its workspace, not just its agent (a Stopped row ends then). */
  closed?: true
}

type Listener = (event: AgentSourceEvent) => void
const listeners = new Set<Listener>()

export function notifyAgentSource(event: AgentSourceEvent): void {
  for (const listener of listeners) {
    // A failing listener never breaks the emitter it is called from.
    try { listener(event) } catch { /* the read model reports its own failures per source */ }
  }
}

type StopListener = (key: string) => void
const stopListeners = new Set<StopListener>()

/** A Stop was asked for this agent key (`thread.interrupt`, `terminal.stop`): the no-report window starts (§13). */
export function notifyAgentStop(key: string): void {
  for (const listener of stopListeners) {
    try { listener(key) } catch { /* as above */ }
  }
}

export function onAgentStop(listener: StopListener): () => void {
  stopListeners.add(listener)
  return () => { stopListeners.delete(listener) }
}

const cancelListeners = new Set<StopListener>()

/** The Stop failed (`interrupt` or `terminal.stop` threw): nothing was stopped, so its no-report window ends. */
export function notifyAgentStopFailed(key: string): void {
  for (const listener of cancelListeners) {
    try { listener(key) } catch { /* as above */ }
  }
}

export function onAgentStopFailed(listener: StopListener): () => void {
  cancelListeners.add(listener)
  return () => { cancelListeners.delete(listener) }
}

export function onAgentSource(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
