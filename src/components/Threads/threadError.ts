import { i18n } from '../../i18n'
import { humanizeError } from '../../utils/humanizeError'

/** A readable message for an error from a Thread action (see humanizeError). */
/**
 * T88: main reports "THREAD_ACCOUNT_UNAVAILABLE: …" when the agent's CLI can't be found or its account can't be read.
 * The person sees what to do; the code stays in the error's details.
 */
export const ACCOUNT_UNAVAILABLE = 'THREAD_ACCOUNT_UNAVAILABLE'
export const isAccountUnavailable = (error: unknown): boolean => String(error instanceof Error ? error.message : error).includes(ACCOUNT_UNAVAILABLE)

export function threadError(error: unknown): string {
  if (isAccountUnavailable(error)) return i18n.t('thread:errors.accountUnavailable')
  return humanizeError(error, i18n.t('thread:errors.action'))
}
