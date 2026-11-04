/**
 * S7.1 · The agents overview as it crosses the IPC boundary (CCR #513, spec §14). Re-exported by `../ipc`.
 * None of these is an MCP tool: shared/mcp-coverage.ts lists them as `code.agents_overview`, forbidden.
 */
import type { AgentKey, AgentsChange, AgentsOverview } from '../agents'

export const AGENTS_CHANNELS = {
  overview: 'agents:overview',
  markSeen: 'agents:mark-seen',
  onChanged: 'agents:changed'
} as const

export interface AgentsApi {
  /** Every agent the person runs, with each source's status. */
  overview(): Promise<AgentsOverview>
  /** The person looked at it: a finished agent is no longer news, across restarts. */
  markSeen(key: AgentKey): Promise<void>
  /** Pushed within a second of any change. */
  onChanged(listener: (change: AgentsChange) => void): () => void
}
