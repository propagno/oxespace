import type { AgentAccountContext, AgentAccountSnapshot } from '../../../shared/types/agentAuth'
import type { ThreadProvider } from '../../../shared/types/thread'
import { i18n } from '../../i18n'

// The wording of a provider account's state, shared by the accounts panel (lazy), the first-run checklist and
// the conversation view. Kept apart so those do not pull the panel into the renderer entry.
type AccountMessage = 'checking' | 'activeTurn' | 'timeout' | 'cancelled' | 'configuration' | 'missingCli' | 'error' | 'subscription' | 'otherMethod' | 'awaitingCode' | 'awaitingBrowser' | 'connecting' | 'disconnected'

function accountMessageKey(status?: AgentAccountSnapshot): AccountMessage {
  if (!status) return 'checking'
  if (status.errorCode === 'active-turn') return 'activeTurn'
  if (status.errorCode === 'timeout') return 'timeout'
  if (status.errorCode === 'cancelled') return 'cancelled'
  if (status.errorCode === 'configuration') return 'configuration'
  if (status.state === 'missing-cli') return 'missingCli'
  if (status.state === 'error') return 'error'
  if (status.state === 'connected') return status.method === 'subscription' ? 'subscription' : 'otherMethod'
  if (status.state === 'awaiting-code') return 'awaitingCode'
  if (status.state === 'awaiting-browser') return 'awaitingBrowser'
  if (status.state === 'connecting' || status.state === 'checking') return 'connecting'
  return 'disconnected'
}

export function accountMessage(status?: AgentAccountSnapshot): string {
  const key = accountMessageKey(status)
  if (key === 'subscription' && status?.planLabel) return i18n.t('thread:accounts.message.subscriptionPlan', { plan: status.planLabel })
  return i18n.t(`thread:accounts.message.${key}`)
}
export function accountContext(provider: ThreadProvider, workspaceId: string, thread?: { id: string; provider: ThreadProvider }): AgentAccountContext {
  return { provider, workspaceId, ...(thread?.provider === provider ? { threadId: thread.id } : {}) }
}
