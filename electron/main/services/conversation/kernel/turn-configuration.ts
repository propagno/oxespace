/**
 * The configuration a turn runs with. One definition of the defaults, so the
 * queue, send, drain and configure paths cannot drift apart.
 */
import type { ThreadConfiguration, ConversationThread } from '../../../../../shared/types/thread'

type ConfigurationSource = Pick<ConversationThread, 'model' | 'reasoningEffort' | 'access' | 'networkAccess' | 'approvalPolicy' | 'mode' | 'hooksEnabled'>

/** Current thread settings with the documented defaults filled in. */
export function turnConfiguration(thread: ConfigurationSource): ThreadConfiguration {
  return {
    model: thread.model,
    reasoningEffort: thread.reasoningEffort,
    access: thread.access ?? 'read-only',
    networkAccess: thread.networkAccess ?? false,
    approvalPolicy: thread.approvalPolicy ?? 'on-request',
    mode: thread.mode ?? 'default',
    hooksEnabled: thread.hooksEnabled ?? false
  }
}

/** `input` fields win over `previous`; anything left unset gets the defaults. */
export function mergeTurnConfiguration(previous: Partial<ConfigurationSource>, input: Partial<ThreadConfiguration>): ThreadConfiguration {
  return turnConfiguration({
    model: input.model ?? previous.model,
    reasoningEffort: input.reasoningEffort ?? previous.reasoningEffort,
    access: input.access ?? previous.access,
    networkAccess: input.networkAccess ?? previous.networkAccess,
    approvalPolicy: input.approvalPolicy ?? previous.approvalPolicy,
    mode: input.mode ?? previous.mode,
    hooksEnabled: input.hooksEnabled ?? previous.hooksEnabled
  })
}
