/** herdr's agent lifecycle states; see electron/main/services/agent-state. */
export type AgentLifecycleState = 'working' | 'blocked' | 'done' | 'idle' | 'unknown'

export interface PaneAgentState {
  paneId: string
  workspaceId: string
  /** Manifest id: claude, codex, copilot, cursor... */
  agent: string
  state: AgentLifecycleState
  source: 'hook' | 'screen'
  seen: boolean
  /** When the current state began. */
  since: number
  /** Increases on every published change. */
  stateChangeSeq: number
  /** Increases when a turn finishes (working to idle); startup and restore do not count. */
  completionSeq: number
}

/** A pane's agent left (exit, stop or session end). */
export interface PaneAgentCleared { paneId: string; workspaceId: string; cleared: true }

export type PaneAgentStateEvent = PaneAgentState | PaneAgentCleared

export interface AgentStateApi {
  list(workspaceId?: string): Promise<PaneAgentState[]>
  /** The person looked at the pane: a finished turn is no longer news. */
  markSeen(paneId: string): Promise<void>
  explain(paneId: string): Promise<unknown>
  onChanged(listener: (event: PaneAgentStateEvent) => void): () => void
}
