import type { ResolvedConnection } from './oxequery-errors'

/**
 * A sentence to add to a failed connection when the server's own words point at TLS. Managed
 * servers (RDS, Cloud SQL, Atlas) commonly refuse an unencrypted client; the server says
 * "no encryption" and the form says "TLS off", and nobody connects the two.
 */
export function connectionHint(message: string, connection: Pick<ResolvedConnection, 'sslMode' | 'engine'>): string {
  const mode = connection.sslMode ?? 'disable'
  const refusesPlain = /no encryption|SSL (?:connection )?is required|requires? SSL|TLS (?:is )?required|must use ssl|sslmode/i.test(message)
  if (refusesPlain && (mode === 'disable' || mode === 'prefer')) {
    return ' This server expects an encrypted connection: open Security (TLS) and choose "require" (or "verify-full" with the CA).'
  }
  if (/self[- ]signed certificate|unable to verify the first certificate|certificate verify failed/i.test(message) && (mode === 'verify-ca' || mode === 'verify-full')) {
    return ' The server certificate is not trusted: add its CA certificate under Security (TLS).'
  }
  return ''
}
