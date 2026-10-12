import type { ConnectionOptions } from 'node:tls'
import type { ResolvedConnection } from './oxequery-errors'

/** Where the driver should actually dial: the real server, or the local end of an SSH tunnel. */
export interface Endpoint { host: string; port: number }

/**
 * TLS for node-postgres.
 *   disable / prefer  no TLS
 *   require           encrypted, certificate NOT verified
 *   verify-ca         chain verified against the CA, host name not checked
 *   verify-full       chain and host name verified
 * When dialing through a tunnel the host name to verify is still the real server's.
 */
export function pgSsl(connection: ResolvedConnection): false | ConnectionOptions {
  const { sslMode, tls } = connection
  if (sslMode === 'disable' || sslMode === 'prefer') return false
  const material: ConnectionOptions = { ...(tls?.ca ? { ca: tls.ca } : {}), ...(tls?.cert && tls.key ? { cert: tls.cert, key: tls.key } : {}) }
  if (sslMode === 'require') return { ...material, rejectUnauthorized: false }
  if (sslMode === 'verify-ca') return { ...material, rejectUnauthorized: true, checkServerIdentity: () => undefined }
  return { ...material, rejectUnauthorized: true, servername: connection.host }
}

/** The pieces of a Mongo connection that are not part of the URI. */
export function mongoTlsOptions(connection: ResolvedConnection): Record<string, unknown> {
  const { sslMode, tls } = connection
  if (sslMode === 'disable' || sslMode === 'prefer') return {}
  const material = { ...(tls?.ca ? { ca: tls.ca } : {}), ...(tls?.cert && tls.key ? { cert: tls.cert, key: tls.key } : {}) }
  if (sslMode === 'require') return { ...material, tls: true, tlsAllowInvalidCertificates: true, tlsAllowInvalidHostnames: true }
  if (sslMode === 'verify-ca') return { ...material, tls: true, tlsAllowInvalidHostnames: true }
  return { ...material, tls: true, servername: connection.host }
}

function bracket(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
}

/**
 * The connection string for the driver. Credentials are URL-encoded; TLS key
 * material is passed as options, never in the string.
 */
export function mongoUri(connection: ResolvedConnection, endpoint: Endpoint = { host: connection.host, port: connection.port }): string {
  const options = connection.mongo ?? { authSource: '', replicaSet: '', directConnection: true, srv: false, extraHosts: [] }
  const tunneled = endpoint.host !== connection.host || endpoint.port !== connection.port
  const credentials = connection.username ? `${encodeURIComponent(connection.username)}${connection.password ? `:${encodeURIComponent(connection.password)}` : ''}@` : ''
  const params = new URLSearchParams({ appName: 'OxeQuery' })
  params.set('authSource', options.authSource || (connection.database && !connection.username ? connection.database : 'admin'))
  if (options.replicaSet) params.set('replicaSet', options.replicaSet)
  // SRV needs DNS discovery of the real hosts, which a tunnel cannot follow.
  if (options.srv && !tunneled) return `mongodb+srv://${credentials}${connection.host}/?${params.toString()}`
  // A tunnel reaches exactly one host, so topology discovery would dial addresses that only exist remotely.
  const seeds = [`${bracket(endpoint.host)}:${endpoint.port}`, ...(tunneled ? [] : options.extraHosts)]
  if (tunneled || (options.directConnection && seeds.length === 1 && !options.replicaSet)) params.set('directConnection', 'true')
  return `mongodb://${credentials}${seeds.join(',')}/?${params.toString()}`
}
