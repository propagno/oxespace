/**
 * The configuration a turn runs with. One definition of the defaults, so the
 * queue, send, drain and configure paths cannot drift apart.
 */
import type { ThreadConfiguration } from '../../../../../shared/types/thread'

type ConfigurationSource = Pick<ThreadConfiguration, 'model' | 'reasoningEffort' | 'access' | 'networkAccess' | 'approvalPolicy' | 'mode' | 'customAgentId' | 'hooksEnabled' | 'disabledMcpTools'>

/** Current thread settings with the documented defaults filled in. */
export function turnConfiguration(thread: ConfigurationSource): ThreadConfiguration {
  const disabled = Array.isArray(thread.disabledMcpTools) && thread.disabledMcpTools.length > 0
    ? [...new Set(thread.disabledMcpTools)]
    : undefined
  return {
    model: thread.model,
    reasoningEffort: thread.reasoningEffort,
    access: thread.access ?? 'read-only',
    networkAccess: thread.networkAccess ?? false,
    approvalPolicy: thread.approvalPolicy ?? 'on-request',
    mode: thread.mode ?? 'default',
    customAgentId: thread.customAgentId || undefined,
    hooksEnabled: thread.hooksEnabled ?? false,
    ...(disabled ? { disabledMcpTools: disabled } : {})
  }
}

/** `input` fields win over `previous`; anything left unset gets the defaults. */
export function mergeTurnConfiguration(previous: Partial<ConfigurationSource>, input: Partial<ThreadConfiguration>): ThreadConfiguration {
  const nextDisabled = input.disabledMcpTools !== undefined ? input.disabledMcpTools : previous.disabledMcpTools
  const customAgentId = input.customAgentId === null || input.customAgentId === ''
    ? undefined
    : input.customAgentId ?? previous.customAgentId
  return turnConfiguration({
    model: input.model ?? previous.model,
    reasoningEffort: input.reasoningEffort ?? previous.reasoningEffort,
    access: input.access ?? previous.access,
    networkAccess: input.networkAccess ?? previous.networkAccess,
    approvalPolicy: input.approvalPolicy ?? previous.approvalPolicy,
    mode: input.mode ?? previous.mode,
    customAgentId,
    hooksEnabled: input.hooksEnabled ?? previous.hooksEnabled,
    disabledMcpTools: nextDisabled
  })
}
