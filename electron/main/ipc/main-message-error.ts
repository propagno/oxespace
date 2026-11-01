import { MAIN_MESSAGE_ERROR_TAG, MAIN_MESSAGE_PARAM_LIMITS, type MainMessage } from '../../../shared/messages'
import { sanitizeDiagnosticText } from '../services/diagnostics.service'

/**
 * The one way a handler rejects with a C3 message (see `MAIN_MESSAGE_ERROR_TAG` in `shared/messages.ts`): the error's
 * text is the English sentence, readable on its own in logs and crash reports, then the fixed marker, then the message
 * as JSON. Every text parameter goes through the same redaction as the rest of C3 (the home folder made relative, secrets
 * removed) and is capped, and lists are capped, so nothing private or unbounded crosses IPC or lands in a log.
 */
export class MainMessageError extends Error {
  readonly mainMessage: MainMessage

  constructor(message: MainMessage, text: string) {
    const safe = redactMainMessage(message)
    super(`${capText(sanitizeDiagnosticText(text))}${MAIN_MESSAGE_ERROR_TAG}${JSON.stringify(safe)}`)
    this.name = 'MainMessageError'
    this.mainMessage = safe
  }
}

/** The message with each text parameter redacted and capped, and each list capped. Numbers and booleans pass. */
export function redactMainMessage(message: MainMessage): MainMessage {
  const params = Object.fromEntries(Object.entries(message.params as Record<string, unknown>).map(([name, value]) => [name, redactValue(value)]))
  return { code: message.code, params } as MainMessage
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return capText(sanitizeDiagnosticText(value))
  if (Array.isArray(value)) return value.slice(0, MAIN_MESSAGE_PARAM_LIMITS.listLength).map(redactValue)
  return value
}

function capText(text: string): string {
  return text.length > MAIN_MESSAGE_PARAM_LIMITS.textLength ? `${text.slice(0, MAIN_MESSAGE_PARAM_LIMITS.textLength - 1)}…` : text
}
