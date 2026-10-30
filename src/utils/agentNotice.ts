import { withoutReservedName } from '../../shared/approval-rules'

/**
 * B10 · The agent-supplied parts of the app's turn notices. A pane label can be a name an agent chose
 * (`oxespace_agents_change start` with `name`) and an error is the agent's own text, so a reserved app name in them is
 * replaced; the notice's fixed words are the app's and stay.
 */
export function paneNoticeLabel(pane: { displayName?: string | null; agentName?: string | null }): string {
  const label = (pane.displayName || pane.agentName || 'Agente').trim()
  return withoutReservedName(label, 'Agente') || 'Agente'
}

export function agentErrorDetail(error: string | null | undefined): string {
  return withoutReservedName(error ?? '') || 'the agent hit an error.'
}
