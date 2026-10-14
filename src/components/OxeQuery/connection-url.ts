import type { DatabaseEngine, MongoOptions, SslMode } from '../../../shared/types/oxequery'

export interface ParsedConnectionUrl {
  engine: DatabaseEngine
  host: string
  port: number
  database: string
  username: string
  password: string
  sslMode: SslMode
  mongo: MongoOptions
}

const DEFAULT_PORT: Record<DatabaseEngine, number> = { postgres: 5432, mongodb: 27017 }

function decode(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

/** `host`, `host:port` or `[v6]:port` -> parts, or null when it is not one of those. */
function splitHost(value: string, fallbackPort: number): { host: string; port: number } | null {
  const bracketed = /^\[([0-9a-fA-F:]+)\](?::(\d{1,5}))?$/.exec(value)
  if (bracketed) return { host: bracketed[1], port: bracketed[2] ? Number(bracketed[2]) : fallbackPort }
  const plain = /^([^\s/\\@?#:,]+)(?::(\d{1,5}))?$/.exec(value)
  if (plain) return { host: plain[1], port: plain[2] ? Number(plain[2]) : fallbackPort }
  return null
}

/**
 * Reads a `postgres://` or `mongodb://` (or `mongodb+srv://`) connection string
 * so a pasted URL fills the whole form. Returns an error message rather than
 * throwing.
 */
export function parseConnectionUrl(input: string): { ok: true; value: ParsedConnectionUrl } | { ok: false; error: string } {
  const text = input.trim()
  if (!text) return { ok: false, error: 'Paste a connection string such as postgres://user:password@localhost:5432/app' }
  const match = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(text)
  if (!match) return { ok: false, error: 'A connection string starts with postgres:// or mongodb://' }
  const scheme = match[1].toLowerCase()
  const engine: DatabaseEngine | null = scheme === 'postgres' || scheme === 'postgresql' ? 'postgres' : scheme === 'mongodb' || scheme === 'mongodb+srv' ? 'mongodb' : null
  if (!engine) return { ok: false, error: `Unsupported scheme "${scheme}". Use postgres:// or mongodb://` }
  const srv = scheme === 'mongodb+srv'

  const [rest, fragment] = match[2].split('#', 2)
  void fragment
  const queryAt = rest.indexOf('?')
  const beforeQuery = queryAt === -1 ? rest : rest.slice(0, queryAt)
  const query = new URLSearchParams(queryAt === -1 ? '' : rest.slice(queryAt + 1))
  const slashAt = beforeQuery.indexOf('/')
  const authority = slashAt === -1 ? beforeQuery : beforeQuery.slice(0, slashAt)
  const database = decode(slashAt === -1 ? '' : beforeQuery.slice(slashAt + 1))
  const atAt = authority.lastIndexOf('@')
  const credentials = atAt === -1 ? '' : authority.slice(0, atAt)
  const hostList = atAt === -1 ? authority : authority.slice(atAt + 1)
  if (!hostList) return { ok: false, error: 'The connection string has no host.' }

  const colon = credentials.indexOf(':')
  const username = decode(colon === -1 ? credentials : credentials.slice(0, colon))
  const password = colon === -1 ? '' : decode(credentials.slice(colon + 1))

  const hosts = hostList.split(',').map(entry => entry.trim()).filter(Boolean)
  if (engine === 'postgres' && hosts.length > 1) return { ok: false, error: 'Several PostgreSQL hosts are not supported. Enter a single host.' }
  if (srv && hosts.length > 1) return { ok: false, error: 'A mongodb+srv address is one DNS name, without a port.' }
  const parsed = hosts.map(entry => splitHost(entry, DEFAULT_PORT[engine]))
  if (parsed.some(entry => entry === null || entry.port < 1 || entry.port > 65535)) return { ok: false, error: 'That connection string could not be read: a host or port is invalid.' }
  const [first, ...others] = parsed as { host: string; port: number }[]

  const tls = (query.get('sslmode') ?? query.get('tls') ?? query.get('ssl') ?? '').toLowerCase()
  const sslMode: SslMode = srv && tls === '' ? 'require'
    : tls === 'verify-full' ? 'verify-full'
      : tls === 'verify-ca' ? 'verify-ca'
        : ['require', 'true'].includes(tls) ? 'require' : 'disable'
  const direct = query.get('directConnection')
  const replicaSet = query.get('replicaSet') ?? ''

  return {
    ok: true,
    value: {
      engine, host: first.host, port: srv ? DEFAULT_PORT.mongodb : first.port, database, username, password, sslMode,
      mongo: {
        authSource: engine === 'mongodb' ? query.get('authSource') ?? '' : '',
        replicaSet: engine === 'mongodb' ? replicaSet : '',
        directConnection: direct !== null ? direct === 'true' : others.length === 0 && !replicaSet && !srv,
        srv,
        extraHosts: engine === 'mongodb' ? others.map(entry => `${entry.host.includes(':') ? `[${entry.host}]` : entry.host}:${entry.port}`) : []
      }
    }
  }
}

export interface UrlParts {
  engine: DatabaseEngine
  host: string
  port: number
  database: string
  username: string
  sslMode: SslMode
  mongo: MongoOptions
}

const encode = (value: string): string => encodeURIComponent(value)
const hostText = (host: string): string => host.includes(':') && !host.startsWith('[') ? `[${host}]` : host

/**
 * The connection string for what the form holds. The password is never part of it: it is stored
 * apart, so a string built from a saved connection can be shown and copied without exposing it.
 */
export function buildConnectionUrl(parts: UrlParts): string {
  const srv = parts.engine === 'mongodb' && parts.mongo.srv
  const scheme = parts.engine === 'postgres' ? 'postgres' : srv ? 'mongodb+srv' : 'mongodb'
  const user = parts.username ? `${encode(parts.username)}@` : ''
  const hosts = [srv ? hostText(parts.host) : `${hostText(parts.host)}:${parts.port}`, ...(srv ? [] : parts.mongo.extraHosts)].join(',')
  const query = new URLSearchParams()
  if (parts.engine === 'mongodb') {
    if (parts.mongo.authSource) query.set('authSource', parts.mongo.authSource)
    if (parts.mongo.replicaSet) query.set('replicaSet', parts.mongo.replicaSet)
    if (!srv && parts.mongo.directConnection === false) query.set('directConnection', 'false')
    if (!srv && parts.mongo.directConnection && (parts.mongo.extraHosts.length > 0 || parts.mongo.replicaSet)) query.set('directConnection', 'true')
    if (parts.sslMode === 'verify-full' || parts.sslMode === 'verify-ca') query.set('tls', parts.sslMode)
    else if (parts.sslMode === 'require') query.set('tls', 'true')
    else if (srv) query.set('tls', 'false')
  } else if (parts.sslMode !== 'disable' && parts.sslMode !== 'prefer') query.set('sslmode', parts.sslMode)
  const tail = query.toString()
  return `${scheme}://${user}${hosts}/${parts.database ? encode(parts.database) : ''}${tail ? `?${tail}` : ''}`
}
