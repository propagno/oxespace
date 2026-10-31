import { isMessageCode, messageKey, messageValues, type MainMessage, type MessageCode } from '../../shared/messages'
import { errorText } from '../utils/humanizeError'
import { currentLanguage, i18n } from './index'

/**
 * A code from the main process (C3) in the interface language: `main:messages.<code>` with its parameters, lists joined
 * the way the language writes them. The `main` catalog's messages load with the language (src/i18n/locales).
 */
export function formatMainMessage(message: MainMessage): string {
  return i18n.t(messageKey(message.code) as never, { ns: 'main', ...messageValues(message, currentLanguage()) }) as string
}

/**
 * The words of a parameterless C3 code a failed request carries as its whole message (a refusal such as
 * `diagnostics.bundle.tooLarge`), or null when the error is something else.
 */
export function mainMessageFromError(cause: unknown, codes: readonly MessageCode[]): string | null {
  const code = errorText(cause)
  return isMessageCode(code) && codes.includes(code) ? formatMainMessage({ code, params: {} } as MainMessage) : null
}
