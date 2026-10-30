import { messageKey, messageValues, type MainMessage } from '../../shared/messages'
import { currentLanguage, i18n, loadNamespace } from './index'

/** Loads the `main` catalog (the words of the main process's codes) in the language on screen. */
export function loadMainMessages(): Promise<void> {
  return loadNamespace('main')
}

/**
 * A code from the main process (C3) in the interface language: `main:messages.<code>` with its parameters, lists joined
 * the way the language writes them. Call loadMainMessages() first; until then the key comes back.
 */
export function formatMainMessage(message: MainMessage): string {
  const language = currentLanguage()
  return i18n.t(messageKey(message.code) as never, { ns: 'main', ...messageValues(message, language) }) as string
}
