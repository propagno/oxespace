import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../../db'
import type { ConnectionEnvironment, DatabaseEngine, OxeQueryConnection, OxeQueryConnectionInput, SslMode } from '../../../../shared/types/oxequery'
import type { ResolvedConnection } from './oxequery-errors'

/** Encryption seam: Electron's safeStorage in the app, a fake in tests. */
export interface SecretCipher {
  available(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

interface Row {
  id: string; name: string; engine: DatabaseEngine; host: string; port: number; database_name: string; username: string
  ssl_mode: SslMode; read_only: number; environment: ConnectionEnvironment; container_ref: string | null; has_password: number
  created_at: number; updated_at: number
}

export class ConnectionInputError extends Error {}

const ENGINES = new Set<DatabaseEngine>(['postgres', 'mongodb'])
const SSL = new Set<SslMode>(['disable', 'prefer', 'require'])
const ENVIRONMENTS = new Set<ConnectionEnvironment>(['local', 'dev', 'prod'])
const secretKey = (id: string): string => `oxequery:${id}`

function toConnection(row: Row): OxeQueryConnection {
  return {
    id: row.id, name: row.name, engine: row.engine, host: row.host, port: row.port, database: row.database_name, username: row.username,
    sslMode: row.ssl_mode, readOnly: row.read_only === 1, environment: row.environment,
    ...(row.container_ref ? { containerRef: row.container_ref } : {}), hasPassword: row.has_password === 1,
    createdAt: row.created_at, updatedAt: row.updated_at
  }
}

/** Validated, trimmed values for a connection. Throws ConnectionInputError with a message fit for the UI. */
export function normalizeConnectionInput(input: OxeQueryConnectionInput): Required<Omit<OxeQueryConnectionInput, 'id' | 'password' | 'clearPassword' | 'containerRef'>> & { containerRef?: string } {
  const name = String(input.name ?? '').trim()
  if (!name || name.length > 80) throw new ConnectionInputError('Give the connection a name (up to 80 characters).')
  if (!ENGINES.has(input.engine)) throw new ConnectionInputError('Choose PostgreSQL or MongoDB.')
  const host = String(input.host ?? '').trim()
  if (!host || host.length > 255 || /[\s/\\@?#]/.test(host)) throw new ConnectionInputError('Enter a valid host name or address.')
  const port = Number(input.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConnectionInputError('The port must be between 1 and 65535.')
  const database = String(input.database ?? '').trim()
  const username = String(input.username ?? '').trim()
  if (database.length > 255 || username.length > 255 || database.includes('\0') || username.includes('\0')) throw new ConnectionInputError('The database or user name is too long.')
  const sslMode = input.sslMode ?? 'disable'
  if (!SSL.has(sslMode)) throw new ConnectionInputError('Unsupported TLS mode.')
  const environment = input.environment ?? 'local'
  if (!ENVIRONMENTS.has(environment)) throw new ConnectionInputError('Unsupported environment.')
  const containerRef = input.containerRef?.trim()
  if (containerRef && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(containerRef)) throw new ConnectionInputError('Invalid container reference.')
  return { name, engine: input.engine, host, port, database, username, sslMode, readOnly: input.readOnly ?? true, environment, ...(containerRef ? { containerRef } : {}) }
}

/** Saved connections. Passwords go to `secure_credentials` and never come back out of this class except via resolve(). */
export class ConnectionStore {
  constructor(private readonly db: AppDatabase, private readonly cipher: SecretCipher) {}

  list(): OxeQueryConnection[] {
    return (this.db.prepare('SELECT * FROM oxequery_connections ORDER BY name COLLATE NOCASE').all() as Row[]).map(toConnection)
  }

  get(id: string): OxeQueryConnection {
    const row = this.db.prepare('SELECT * FROM oxequery_connections WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new ConnectionInputError('That connection no longer exists.')
    return toConnection(row)
  }

  save(input: OxeQueryConnectionInput): OxeQueryConnection {
    const value = normalizeConnectionInput(input)
    const now = Date.now()
    const existing = input.id ? this.db.prepare('SELECT id, has_password FROM oxequery_connections WHERE id = ?').get(input.id) as { id: string; has_password: number } | undefined : undefined
    if (input.id && !existing) throw new ConnectionInputError('That connection no longer exists.')
    const id = existing?.id ?? randomUUID()
    const password = typeof input.password === 'string' && input.password.length > 0 ? input.password : undefined
    if (password && password.length > 1024) throw new ConnectionInputError('The password is too long.')
    // A secret is never stored in the clear: without OS encryption there is nowhere safe to keep it.
    if (password && !this.cipher.available()) throw new ConnectionInputError('Secure storage is unavailable on this system, so the password cannot be saved. Use a connection without a stored password.')
    let hasPassword = existing?.has_password === 1
    this.db.transaction(() => {
      if (input.clearPassword) {
        this.db.prepare('DELETE FROM secure_credentials WHERE provider = ?').run(secretKey(id))
        hasPassword = false
      }
      if (password) {
        this.db.prepare(`INSERT INTO secure_credentials (provider, payload, encrypted, label, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)
          ON CONFLICT(provider) DO UPDATE SET payload = excluded.payload, encrypted = 1, label = excluded.label, updated_at = excluded.updated_at`)
          .run(secretKey(id), this.cipher.encrypt(password), value.name, now, now)
        hasPassword = true
      }
      this.db.prepare(`INSERT INTO oxequery_connections (id, name, engine, host, port, database_name, username, ssl_mode, read_only, environment, container_ref, has_password, created_at, updated_at)
        VALUES (@id, @name, @engine, @host, @port, @database, @username, @sslMode, @readOnly, @environment, @containerRef, @hasPassword, @now, @now)
        ON CONFLICT(id) DO UPDATE SET name = @name, engine = @engine, host = @host, port = @port, database_name = @database, username = @username, ssl_mode = @sslMode,
          read_only = @readOnly, environment = @environment, container_ref = @containerRef, has_password = @hasPassword, updated_at = @now`)
        .run({ id, ...value, containerRef: value.containerRef ?? null, readOnly: value.readOnly ? 1 : 0, hasPassword: hasPassword ? 1 : 0, now })
    })()
    return this.get(id)
  }

  delete(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM secure_credentials WHERE provider = ?').run(secretKey(id))
      this.db.prepare('DELETE FROM oxequery_connections WHERE id = ?').run(id)
    })()
  }

  /** The only path that returns a secret, and only to code that talks to the database. */
  resolve(id: string): ResolvedConnection {
    const connection = this.get(id)
    let password: string | undefined
    if (connection.hasPassword) {
      const row = this.db.prepare('SELECT payload, encrypted FROM secure_credentials WHERE provider = ?').get(secretKey(id)) as { payload: Buffer; encrypted: number } | undefined
      if (row) password = row.encrypted === 1 ? this.cipher.decrypt(Buffer.from(row.payload)) : Buffer.from(row.payload).toString('utf8')
    }
    return {
      id: connection.id, engine: connection.engine, host: connection.host, port: connection.port, database: connection.database, username: connection.username,
      ...(password ? { password } : {}), sslMode: connection.sslMode, readOnly: connection.readOnly
    }
  }
}
