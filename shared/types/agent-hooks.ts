/**
 * Agent status delivered by the agents' own lifecycle hooks (Claude Code and
 * Codex), as opposed to the output-timing heuristic. Hooks are authoritative
 * when present; the heuristic remains the fallback.
 */
export type AgentHookAgent = 'claude-code' | 'codex'

/** `ended` clears the hook-derived status (the agent process is gone). */
export type AgentHookState = 'working' | 'waiting' | 'done' | 'ended'

export interface AgentHookStatusEvent {
  paneId: string
  workspaceId: string
  agent: AgentHookAgent
  state: AgentHookState
  /** The agent's own hook event name, e.g. `PermissionRequest`. */
  event: string
  at: number
  sessionId: string | null
}

export type AgentHooksInstallState = 'installed' | 'partial' | 'not_installed' | 'error'

export interface AgentHooksStatus {
  agent: AgentHookAgent
  state: AgentHooksInstallState
  /** Managed events the installed config lacks (or that this agent version cannot take). */
  missing: string[]
  detail: string | null
}
