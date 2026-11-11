import type { ThreadProvider } from './types/thread'

/** The agents a conversation can run with, in the order they are offered. */
export const THREAD_PROVIDERS = ['claude', 'codex', 'antigravity'] as const satisfies readonly ThreadProvider[]

/** The agent's short name, as a message, an approval or a notification names it. */
export function threadAgentName(provider: ThreadProvider): 'Claude' | 'Codex' | 'Antigravity' {
  return provider === 'codex' ? 'Codex' : provider === 'antigravity' ? 'Antigravity' : 'Claude'
}

/** The product's name, as accounts, settings and the agent picker name it. */
export function threadProductName(provider: ThreadProvider): 'Claude Code' | 'Codex' | 'Antigravity' {
  return provider === 'claude' ? 'Claude Code' : provider === 'codex' ? 'Codex' : 'Antigravity'
}
