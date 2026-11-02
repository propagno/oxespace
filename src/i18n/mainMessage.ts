import { messageKey, messageValues, type MainMessage } from '../../shared/messages'
import { currentLanguage, i18n } from './index'

/**
 * A message from the main process in the interface language (C3). The main process sends a code and its parameters,
 * never a sentence; the words are `messages.<code>` in the `main` catalog, with lists joined the way the language
 * writes them.
 */
export function formatMainMessage(message: MainMessage): string {
  return (i18n.t as unknown as (key: string, options: object) => string)(messageKey(message.code), { ns: 'main', ...messageValues(message, currentLanguage()) })
}
