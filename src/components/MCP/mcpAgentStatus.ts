import type { ThreadMcpServerStatus } from '../../../shared/types/thread'
import { i18n } from '../../i18n'

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

const STATES: McpAgentState[] = ['connected', 'failed', 'needs-auth', 'pending', 'disabled', 'unknown', 'not-loaded', 'not-checked']

/** Short name and explanation of each state, read in the interface language each time. */
const byState = (kind: 'label' | 'hint'): Record<McpAgentState, string> => Object.defineProperties({} as Record<McpAgentState, string>,
  Object.fromEntries(STATES.map(state => [state, { enumerable: true, get: () => i18n.t(`mcp.agentState.${kind}.${state}`, { ns: 'code' }) }])))

export const AGENT_STATE_LABEL = byState('label')
export const AGENT_STATE_HINT = byState('hint')
