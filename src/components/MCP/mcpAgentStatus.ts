import type { ThreadMcpServerStatus } from '../../../shared/types/thread'

/**
 * Whether the agent itself connected to a server, which is what decides if its
 * tools are usable. OXESpace's own test only says the server answers.
 * `not-loaded`: the conversation's session started without it (added later, or
 * disabled). `not-checked`: no conversation is open to ask.
 */
export type McpAgentState = ThreadMcpServerStatus['status'] | 'not-loaded' | 'not-checked'

/** The key the server is written under in `.mcp.json` and the Thread launch config. */
export const mcpServerKey = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp-server'

export function agentStatusFor(name: string, conversation: ThreadMcpServerStatus[] | undefined): McpAgentState {
  if (!conversation) return 'not-checked'
  const key = mcpServerKey(name)
  return conversation.find(server => server.name === key || server.name === name)?.status ?? 'not-loaded'
}

export const AGENT_STATE_LABEL: Record<McpAgentState, string> = {
  connected: 'Agent connected',
  failed: 'Agent failed to connect',
  'needs-auth': 'Agent needs sign-in',
  pending: 'Agent connecting',
  disabled: 'Disabled in the agent',
  unknown: 'Agent state unknown',
  'not-loaded': 'Not in this conversation',
  'not-checked': 'Agent not checked'
}

export const AGENT_STATE_HINT: Record<McpAgentState, string> = {
  connected: 'The agent of this conversation connected and can call its tools.',
  failed: 'The agent could not start or reach it when the session began.',
  'needs-auth': 'Run /mcp in Claude Code, or start a conversation, to sign in.',
  pending: 'The agent was still connecting when it last reported.',
  disabled: 'The agent has this server turned off.',
  unknown: 'The agent did not say.',
  'not-loaded': 'The session started without it. New conversations pick it up.',
  'not-checked': 'Open a Thread conversation to see whether the agent connected. Terminals pick it up when the agent restarts.'
}
