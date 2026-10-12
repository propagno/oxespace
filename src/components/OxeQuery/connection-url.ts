import type { DatabaseEngine, SslMode } from '../../../shared/types/oxequery'

export interface ParsedConnectionUrl {
  engine: DatabaseEngine
  host: string
  port: number
  database: string
  username: string
  password: string
  sslMode: SslMode
}

const DEFAULT_PORT: Record<DatabaseEngine, number> = { postgres: 5432, mongodb: 27017 }

/**
 * Reads a `postgres://` or `mongodb://` connection string so a pasted URL fills
 * the whole form. Returns an error message rather than throwing.
 */
export function parseConnectionUrl(input: string): { ok: true; value: ParsedConnectionUrl } | { ok: false; error: string } {
  const text = input.trim()
  if (!text) return { ok: false, error: 'Paste a connection string such as postgres://user:password@localhost:5432/app' }
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text)?.[1].toLowerCase()
  if (!scheme) return { ok: false, error: 'A connection string starts with postgres:// or mongodb://' }
  if (scheme === 'mongodb+srv') return { ok: false, error: 'mongodb+srv:// needs DNS discovery, which is not supported. Use a mongodb:// address with host and port.' }
  const engine: DatabaseEngine | null = scheme === 'postgres' || scheme === 'postgresql' ? 'postgres' : scheme === 'mongodb' ? 'mongodb' : null
  if (!engine) return { ok: false, error: `Unsupported scheme "${scheme}". Use postgres:// or mongodb://` }
  const authority = text.replace(/^[a-z+]+:\/\//i, '').split(/[/?#]/)[0].split('@').pop() ?? ''
  if (authority.includes(',')) return { ok: false, error: 'Several hosts are not supported. Enter a single host.' }
  let url: URL
  try { url = new URL(text.replace(/^[a-z]+:\/\//i, 'http://')) } catch { return { ok: false, error: 'That connection string could not be read.' } }
  if (!url.hostname) return { ok: false, error: 'The connection string has no host.' }
  if (url.hostname.includes(',')) return { ok: false, error: 'Several hosts are not supported. Enter a single host.' }
  const decode = (value: string): string => { try { return decodeURIComponent(value) } catch { return value } }
  const tls = (url.searchParams.get('sslmode') ?? url.searchParams.get('tls') ?? url.searchParams.get('ssl') ?? '').toLowerCase()
  return {
    ok: true,
    value: {
      engine,
      host: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port ? Number(url.port) : DEFAULT_PORT[engine],
      database: decode(url.pathname.replace(/^\//, '')),
      username: decode(url.username),
      password: decode(url.password),
      sslMode: ['require', 'verify-ca', 'verify-full', 'true'].includes(tls) ? 'require' : 'disable'
    }
  }
}
