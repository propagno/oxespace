import type { OxepostMessageParams } from '../../shared/messages/oxepost'

/** The parameter names each oxepost code carries, as the catalogs must interpolate them (C3 contract, S0.1 part 2b). */
export const OXEPOST_PARAMETERS: Record<keyof OxepostMessageParams, string[]> = {
  'oxepost.network.notFound': [],
  'oxepost.network.refused': [],
  'oxepost.network.reset': [],
  'oxepost.network.timedOut': [],
  'oxepost.network.lookupFailed': [],
  'oxepost.network.hostUnreachable': [],
  'oxepost.network.networkUnreachable': [],
  'oxepost.send.invalidUrl': [],
  'oxepost.send.scheme': [],
  'oxepost.send.bodyNotAllowed': ['method'],
  'oxepost.send.bodyTooLarge': [],
  'oxepost.send.invalidHeader': ['name'],
  'oxepost.send.timeout': ['seconds'],
  'oxepost.send.tls': ['code'],
  'oxepost.send.failed': [],
  'oxepost.send.failedWith': ['detail']
}
