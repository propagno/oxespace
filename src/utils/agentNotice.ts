import { withoutReservedName } from '../../shared/reserved-names'

/**
 * B10 · The agent-supplied parts of the app's turn notices. A pane label can be a name an agent chose
 * (`oxespace_agents_change start` with `name`) and an error is the agent's own text, so a reserved app name in them is
 * replaced by the caller's `fallback` (its own, translated words); the notice's fixed words are the app's and stay.
 */
export function paneNoticeLabel(pane: { displayName?: string | null; agentName?: string | null }, fallback: string): string {
  const label = (pane.displayName || pane.agentName || '').trim()
  return withoutReservedName(label, fallback) || fallback
}

export function agentErrorDetail(error: string | null | undefined, fallback: string): string {
  // Free text in a notification body: the system's words count anywhere, not only first.
  return withoutReservedName(error ?? '', fallback, 'notice') || fallback
}
