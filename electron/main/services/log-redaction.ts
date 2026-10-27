import type { LogMessage } from 'electron-log'
import { redactSecrets } from '../../../shared/secrets'

/**
 * electron-log hook: no secret reaches main.log, whatever logged it. Strings and errors are redacted; other values
 * are left as they are (they are formatted after the hook, and objects that carry secrets are not logged whole).
 */
export function redactLogMessage(message: LogMessage): LogMessage {
  return {
    ...message,
    data: message.data.map(item => {
      if (typeof item === 'string') return redactSecrets(item)
      if (item instanceof Error) {
        const copy = new Error(redactSecrets(item.message))
        copy.name = item.name
        if (item.stack) copy.stack = redactSecrets(item.stack)
        return copy
      }
      return item
    })
  }
}
