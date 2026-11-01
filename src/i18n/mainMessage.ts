import { messageKey, messageValues, type MainMessage } from '../../shared/messages'
import { i18n } from './index'

/** Words a C3 message from the main process (shared/messages.ts) in the interface language. */
export function formatMainMessage(message: MainMessage): string {
  const translate = i18n.t as unknown as (key: string, options: Record<string, string>) => string
  return translate(messageKey(message.code), { ns: 'main', ...messageValues(message, i18n.language) })
}
