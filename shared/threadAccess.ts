import type { ThreadConfiguration } from './types/thread'

/** What an agent may do in a conversation, from least to most. */
export type ThreadAccess = NonNullable<ThreadConfiguration['access']>
export const THREAD_ACCESS_LEVELS: readonly ThreadAccess[] = ['read-only', 'workspace-write', 'full-access']

/**
 * The access a conversation the person creates starts with, until Settings says otherwise. Full access is the product
 * owner's choice (2026-11-12): a conversation starts with everything the agent has, and the person narrows it when
 * they want to be asked. Before, every conversation started Read only.
 */
export const NEW_CONVERSATION_ACCESS_DEFAULT: ThreadAccess = 'full-access'

export function isThreadAccess(value: unknown): value is ThreadAccess {
  return typeof value === 'string' && (THREAD_ACCESS_LEVELS as readonly string[]).includes(value)
}
