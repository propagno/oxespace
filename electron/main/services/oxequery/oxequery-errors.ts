import type { ConnectionEnvironment, DatabaseEngine, MongoOptions, SslMode } from '../../../../shared/types/oxequery'

/**
 * Types and errors shared by the main process and the database worker. They live
 * apart from the drivers so importing them never pulls `pg`, `mongodb` or `ssh2`
 * into the main bundle.
 */
export type OxeQueryErrorCode =
  | 'read-only' | 'confirm' | 'invalid' | 'connect' | 'query' | 'timeout' | 'cancelled'
  | 'host-key-unknown' | 'host-key-changed' | 'tunnel' | 'conflict'

/** Where and why a statement failed, as reported by the server. */
export interface ErrorDetail { position?: number; sqlState?: string; hint?: string }

export class OxeQueryError extends Error {
  constructor(readonly code: OxeQueryErrorCode, message: string, readonly reasons: string[] = [], readonly detail: ErrorDetail = {}) { super(message) }
}

export class MongoInputError extends Error {}

export interface TunnelSettings {
  host: string
  port: number
  user: string
  password?: string
  privateKey?: string
  passphrase?: string
  /** `SHA256:<base64>` the user trusted before, if any. */
  pinnedFingerprint?: string
}

/** A connection with its secrets resolved. Only ever exists in main and in the database worker. */
export interface ResolvedConnection {
  id: string
  engine: DatabaseEngine
  host: string
  port: number
  database: string
  username: string
  password?: string
  sslMode: SslMode
  readOnly: boolean
  environment?: ConnectionEnvironment
  tls?: { ca?: string; cert?: string; key?: string }
  mongo?: MongoOptions
  ssh?: TunnelSettings
  statementTimeoutMs?: number
  maxRows?: number
}
