import type { AgentsMessageParams } from '../../shared/messages/agents'

/** The parameter names each agents code carries, as the catalogs must interpolate them (C3 contract, S0.1 part 2b). */
export const AGENTS_PARAMETERS: Record<keyof AgentsMessageParams, string[]> = {
  'notify.prefix.pane': ['agent', 'pane', 'title'],
  'notify.prefix.conversation': ['agent', 'conversation', 'title'],
  'notify.prefix.unknownPane': ['pane', 'title'],
  'notify.prefix.unknownConversation': ['conversation', 'title'],
  'notify.refused.reservedName': ['name'],
  'notify.refused.rateLimit': ['perMinute'],
  'agents.name.reserved': ['name']
}
