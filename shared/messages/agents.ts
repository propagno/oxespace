/** C3 message codes of the agents domain (`notify.*`, `agents.*`); merged into `MessageParams` and `MESSAGE_CODES` by shared/messages.ts. */

export interface AgentsMessageParams {
  /** An agent's notification, prefixed with who sent it; `title` is the agent's text. */
  'notify.prefix.pane': { agent: string; pane: number; title: string }
  'notify.prefix.conversation': { agent: string; conversation: string; title: string }
  'notify.prefix.unknownPane': { pane: number; title: string }
  'notify.prefix.unknownConversation': { conversation: string; title: string }
  'notify.refused.reservedName': { name: string }
  'notify.refused.rateLimit': { perMinute: number }
  /** A pane name an agent chose contains a name only the app uses. */
  'agents.name.reserved': { name: string }
}

export const AGENTS_MESSAGE_CODES = [
  'notify.prefix.pane',
  'notify.prefix.conversation',
  'notify.prefix.unknownPane',
  'notify.prefix.unknownConversation',
  'notify.refused.reservedName',
  'notify.refused.rateLimit',
  'agents.name.reserved'
] as const satisfies readonly (keyof AgentsMessageParams)[]
