/** C3 message codes of the oxepost domain (`oxepost.*`); merged into `MessageParams` and `MESSAGE_CODES` by shared/messages.ts. */

export interface OxepostMessageParams {
  'oxepost.network.notFound': Record<string, never>
  'oxepost.network.refused': Record<string, never>
  'oxepost.network.reset': Record<string, never>
  'oxepost.network.timedOut': Record<string, never>
  'oxepost.network.lookupFailed': Record<string, never>
  'oxepost.network.hostUnreachable': Record<string, never>
  'oxepost.network.networkUnreachable': Record<string, never>
  'oxepost.send.invalidUrl': Record<string, never>
  'oxepost.send.scheme': Record<string, never>
  'oxepost.send.bodyNotAllowed': { method: string }
  'oxepost.send.bodyTooLarge': Record<string, never>
  'oxepost.send.invalidHeader': { name: string }
  'oxepost.send.timeout': { seconds: number }
  'oxepost.send.tls': { code: string }
  'oxepost.send.failed': Record<string, never>
  'oxepost.send.failedWith': { detail: string }
}

export const OXEPOST_MESSAGE_CODES = [
  'oxepost.network.notFound',
  'oxepost.network.refused',
  'oxepost.network.reset',
  'oxepost.network.timedOut',
  'oxepost.network.lookupFailed',
  'oxepost.network.hostUnreachable',
  'oxepost.network.networkUnreachable',
  'oxepost.send.invalidUrl',
  'oxepost.send.scheme',
  'oxepost.send.bodyNotAllowed',
  'oxepost.send.bodyTooLarge',
  'oxepost.send.invalidHeader',
  'oxepost.send.timeout',
  'oxepost.send.tls',
  'oxepost.send.failed',
  'oxepost.send.failedWith'
] as const satisfies readonly (keyof OxepostMessageParams)[]
