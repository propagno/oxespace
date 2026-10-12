import type { DatabaseEngine, SslMode } from '../../../../shared/types/oxequery'

/**
 * Types and errors shared by the main process and the database worker. They live
 * apart from the drivers so importing them never pulls `pg` or `mongodb` into the
 * main bundle.
 */
export class OxeQueryError extends Error {
  constructor(readonly code: 'read-only' | 'confirm' | 'invalid' | 'connect' | 'query' | 'timeout' | 'cancelled', message: string, readonly reasons: string[] = []) { super(message) }
}

export class MongoInputError extends Error {}

/** A connection with its password resolved. Only ever exists in main and in the worker. */
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
}
