import { Client, type ClientConfig } from 'pg'
import { MongoClient } from 'mongodb'
import { OxeQueryError, type ResolvedConnection } from './oxequery-errors'
import { mongoTlsOptions, mongoUri, type Endpoint } from './connection-options'
import type { OpenTunnel } from './ssh-tunnel'
import type { MongoSession, PgSession, SessionRegistry } from './oxequery-sessions'

/** What opening a session needs from the core: where to dial, how, and the error a person may see when it fails. */
export interface ConnectHost {
  sessions: SessionRegistry
  reach(connection: ResolvedConnection): Promise<{ endpoint: Endpoint; tunnel?: OpenTunnel }>
  pgConfig(connection: ResolvedConnection, endpoint: Endpoint): ClientConfig
  connectFailure(error: unknown, connection: ResolvedConnection): OxeQueryError
  connectTimeoutMs: number
}

/** Dials the server (through the tunnel when there is one) under the slot's cap; a failure gives the place back. */
async function dial(host: ConnectHost, connection: ResolvedConnection, slot: string): Promise<{ release: () => void; endpoint: Endpoint; tunnel?: OpenTunnel }> {
  const release = host.sessions.reserve(slot)
  try { return { release, ...await host.reach(connection) } } catch (error) { release(); throw error }
}

/** Opens a Postgres session for one connection and role, and registers it in its slot. */
export async function connectPg(host: ConnectHost, connection: ResolvedConnection, slot: string, key: string): Promise<PgSession> {
  const { release, endpoint, tunnel } = await dial(host, connection, slot)
  // An 'error' event with no listener would crash the worker; the session's own listener is added below.
  const quiet = (candidate: Client): Client => { candidate.on('error', () => undefined); return candidate }
  let config: ClientConfig = host.pgConfig(connection, endpoint)
  let client = quiet(new Client(config))
  try {
    try { await client.connect() } catch (error) {
      // "prefer" tries TLS first; a server without TLS says so, and gets a plain connection like libpq gives it.
      if (connection.sslMode !== 'prefer' || !/does not support SSL|SSL is not enabled|SSL not supported/i.test(error instanceof Error ? error.message : '')) throw error
      config = { ...config, ssl: false }
      client = quiet(new Client(config))
      await client.connect()
    }
  } catch (error) {
    release()
    await tunnel?.close()
    throw host.connectFailure(error, connection)
  }
  const { pg } = host.sessions
  const session: PgSession = { key, slot, role: connection.role ?? 'person', release, client, config, running: false, lastUsed: Date.now(), endpoint, tx: 'none', txStatements: 0, ...(tunnel ? { tunnel } : {}) }
  client.on('error', () => { if (pg.get(slot) === session) { host.sessions.forgetPg(session); void tunnel?.close() } })
  // A tunnel that drops under a live session would leave a client talking to nothing.
  tunnel?.onClose(() => { if (pg.get(slot) === session) host.sessions.forgetPg(session) })
  pg.set(slot, session)
  return session
}

/** Opens a MongoDB client for one connection and role, and registers it in its slot. */
export async function connectMongo(host: ConnectHost, connection: ResolvedConnection, slot: string, key: string): Promise<MongoClient> {
  const { release, endpoint, tunnel } = await dial(host, connection, slot)
  const client = new MongoClient(mongoUri(connection, endpoint), {
    serverSelectionTimeoutMS: host.connectTimeoutMs, connectTimeoutMS: host.connectTimeoutMs, maxPoolSize: 4,
    ...(mongoTlsOptions(connection) as object)
  })
  try { await client.connect() } catch (error) {
    release()
    await client.close().catch(() => undefined)
    await tunnel?.close()
    throw host.connectFailure(error, connection)
  }
  const { mongo } = host.sessions
  const session: MongoSession = { key, slot, role: connection.role ?? 'person', release, client, lastUsed: Date.now(), ...(tunnel ? { tunnel } : {}) }
  tunnel?.onClose(() => { if (mongo.get(slot) === session) host.sessions.forgetMongo(session) })
  mongo.set(slot, session)
  return client
}
