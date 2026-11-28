import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AppDatabase } from '../db/index'
import type { SecretCipher } from './oxequery/connection-store'
import type { McpOAuthConnectResult, McpOAuthStatus } from '../../../shared/types/mcp'
import { openExternalOrRecord } from '../utils/external-open'
import { validateMcpHttpUrl, type McpFetch } from './mcp-http-transport'

const CREDENTIAL_PREFIX = 'mcp:oauth:'
const DEFAULT_CLIENT_ID = 'oxespace'
const DISCOVERY_TIMEOUT_MS = 10_000
const TOKEN_EXCHANGE_TIMEOUT_MS = 15_000
const CALLBACK_TIMEOUT_MS = 120_000
const REFRESH_SKEW_MS = 60_000

export interface StoredMcpOAuthToken {
  accessToken: string
  refreshToken?: string
  tokenType: string
  expiresAtMs: number | null
  scope?: string | null
  tokenEndpoint?: string | null
  clientId?: string | null
  authorizationServer?: string | null
  resourceUrl?: string | null
}

export interface OAuthDiscoveryMetadata {
  authorizationServer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint?: string
  scopesSupported?: string[]
  resource?: string
}

export interface McpOAuthOptions {
  db: AppDatabase
  cipher?: SecretCipher
  fetchImpl?: McpFetch
  openBrowser?: (url: string) => boolean
  callbackTimeoutMs?: number
  now?: () => number
}

export function oauthCredentialKey(serverId: string): string {
  return `${CREDENTIAL_PREFIX}${serverId}`
}

/** Generates a PKCE S256 verifier + challenge pair (RFC 7636). */
export function generatePkcePair(): { codeVerifier: string; codeChallenge: string; method: 'S256' } {
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge, method: 'S256' }
}

/**
 * Discovers OAuth 2.1 authorization metadata for a remote MCP server:
 * 1. RFC 9728 Protected Resource Metadata (`/.well-known/oauth-protected-resource`)
 * 2. RFC 8414 Authorization Server Metadata (`/.well-known/oauth-authorization-server`)
 *    with OpenID Connect fallback (`/.well-known/openid-configuration`).
 */
export async function discoverOAuthMetadata(
  serverUrl: string,
  options: { fetchImpl?: McpFetch; resourceMetadataUrl?: string | null; timeoutMs?: number } = {}
): Promise<OAuthDiscoveryMetadata> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DISCOVERY_TIMEOUT_MS
  const parsedServer = validateMcpHttpUrl(serverUrl)

  const fetchJson = async (url: string): Promise<Record<string, unknown> | null> => {
    const validated = validateMcpHttpUrl(url).toString()
    const signal = AbortSignal.timeout(timeoutMs)
    try {
      const response = await fetchImpl(validated, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal
      })
      if (!response.ok) return null
      const json = await response.json()
      return json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  let authServerOrigin = parsedServer.origin
  let resource = parsedServer.origin + parsedServer.pathname
  let resourceScopes: string[] | undefined

  const protectedCandidates = [
    ...(options.resourceMetadataUrl ? [options.resourceMetadataUrl] : []),
    ...(parsedServer.pathname && parsedServer.pathname !== '/'
      ? [`${parsedServer.origin}/.well-known/oauth-protected-resource${parsedServer.pathname}`]
      : []),
    `${parsedServer.origin}/.well-known/oauth-protected-resource`
  ]

  for (const candidate of protectedCandidates) {
    const protectedMeta = await fetchJson(candidate)
    if (!protectedMeta) continue
    if (typeof protectedMeta.resource === 'string' && protectedMeta.resource.trim()) {
      resource = protectedMeta.resource.trim()
    }
    if (Array.isArray(protectedMeta.authorization_servers)) {
      const first = protectedMeta.authorization_servers.find((item): item is string => typeof item === 'string' && item.trim().length > 0)
      if (first) authServerOrigin = validateMcpHttpUrl(first).toString().replace(/\/+$/, '')
    }
    if (Array.isArray(protectedMeta.scopes_supported)) {
      resourceScopes = protectedMeta.scopes_supported.filter((s): s is string => typeof s === 'string')
    }
    break
  }

  const parsedAuthServer = validateMcpHttpUrl(authServerOrigin)
  const authBasePath = parsedAuthServer.pathname.replace(/\/+$/, '')
  const authCandidates = authBasePath
    ? [
        `${parsedAuthServer.origin}/.well-known/oauth-authorization-server${authBasePath}`,
        `${parsedAuthServer.origin}${authBasePath}/.well-known/oauth-authorization-server`,
        `${parsedAuthServer.origin}/.well-known/openid-configuration${authBasePath}`,
        `${parsedAuthServer.origin}/.well-known/oauth-authorization-server`
      ]
    : [
        `${parsedAuthServer.origin}/.well-known/oauth-authorization-server`,
        `${parsedAuthServer.origin}/.well-known/openid-configuration`
      ]

  for (const candidate of authCandidates) {
    const meta = await fetchJson(candidate)
    if (!meta) continue
    const authEndpoint = typeof meta.authorization_endpoint === 'string' ? meta.authorization_endpoint : null
    const tokenEndpoint = typeof meta.token_endpoint === 'string' ? meta.token_endpoint : null
    if (!authEndpoint || !tokenEndpoint) continue
    const registrationEndpoint = typeof meta.registration_endpoint === 'string' ? validateMcpHttpUrl(meta.registration_endpoint).toString() : undefined
    const scopesSupported = Array.isArray(meta.scopes_supported)
      ? meta.scopes_supported.filter((s): s is string => typeof s === 'string')
      : resourceScopes
    return {
      authorizationServer: typeof meta.issuer === 'string' && meta.issuer ? meta.issuer : authServerOrigin,
      authorizationEndpoint: validateMcpHttpUrl(authEndpoint).toString(),
      tokenEndpoint: validateMcpHttpUrl(tokenEndpoint).toString(),
      ...(registrationEndpoint ? { registrationEndpoint } : {}),
      ...(scopesSupported ? { scopesSupported } : {}),
      resource
    }
  }

  throw new Error('This MCP server did not advertise OAuth 2.1 authorization metadata.')
}

/**
 * Keychain-backed OAuth 2.1 + PKCE token manager for remote MCP servers.
 * Tokens are ALWAYS encrypted via Electron's `safeStorage` (`SecretCipher`) in `secure_credentials`,
 * NEVER persisted in plaintext in `.mcp.json` or `mcp_servers`, and NEVER logged.
 */
export class McpOAuthManager {
  private readonly db: AppDatabase
  private readonly cipher?: SecretCipher
  private readonly fetchImpl: McpFetch
  private readonly openBrowser: (url: string) => boolean
  private readonly callbackTimeoutMs: number
  private readonly now: () => number
  private readonly refreshing = new Map<string, Promise<string | null>>()

  constructor(options: McpOAuthOptions) {
    this.db = options.db
    this.cipher = options.cipher
    this.fetchImpl = options.fetchImpl ?? fetch
    this.openBrowser = options.openBrowser ?? (url => openExternalOrRecord(url))
    this.callbackTimeoutMs = options.callbackTimeoutMs ?? CALLBACK_TIMEOUT_MS
    this.now = options.now ?? (() => Date.now())
  }

  isKeychainAvailable(): boolean {
    return Boolean(this.cipher?.available())
  }

  /** Fast synchronous check used when hydrating server lists (no decryption). */
  hasToken(serverId: string): boolean {
    try {
      const row = this.db.prepare('SELECT 1 FROM secure_credentials WHERE provider = ? AND encrypted = 1').get(oauthCredentialKey(serverId))
      return Boolean(row)
    } catch {
      return false
    }
  }

  /** Reads token metadata status without exposing any token value. */
  status(serverId: string): McpOAuthStatus {
    const keychainAvailable = this.isKeychainAvailable()
    const token = this.readToken(serverId)
    if (!token) {
      return { serverId, connected: false, keychainAvailable }
    }
    return {
      serverId,
      connected: true,
      expiresAtMs: token.expiresAtMs,
      hasRefreshToken: Boolean(token.refreshToken),
      scope: token.scope ?? null,
      authorizationServer: token.authorizationServer ?? null,
      keychainAvailable
    }
  }

  /** Encrypts and persists OAuth tokens in `secure_credentials`. Refuses plaintext storage. */
  saveToken(serverId: string, token: StoredMcpOAuthToken, label = 'MCP OAuth'): void {
    if (!this.cipher || !this.cipher.available()) {
      throw new Error('OS keychain encryption is unavailable; OAuth tokens cannot be saved securely.')
    }
    const encrypted = this.cipher.encrypt(JSON.stringify(token))
    const ts = this.now()
    this.db.prepare(
      `INSERT INTO secure_credentials (provider, payload, encrypted, label, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET payload = excluded.payload, encrypted = 1, label = excluded.label, updated_at = excluded.updated_at`
    ).run(oauthCredentialKey(serverId), encrypted, label.slice(0, 120), ts, ts)
  }

  /** Removes stored OAuth tokens for a server from the keychain table. */
  disconnect(serverId: string): McpOAuthStatus {
    try {
      this.db.prepare('DELETE FROM secure_credentials WHERE provider = ?').run(oauthCredentialKey(serverId))
    } catch {
      // Ignore if DB lacks table in stripped test fixtures
    }
    return { serverId, connected: false, keychainAvailable: this.isKeychainAvailable() }
  }

  /**
   * Returns a valid Bearer access token for `serverId`, refreshing automatically via
   * `refresh_token` if expired. Returns null if no token is stored.
   */
  async getValidAccessToken(serverId: string): Promise<string | null> {
    const token = this.readToken(serverId)
    if (!token) return null
    const expired = token.expiresAtMs !== null && token.expiresAtMs <= this.now() + REFRESH_SKEW_MS
    if (!expired) return token.accessToken
    if (!token.refreshToken || !token.tokenEndpoint) return token.accessToken

    const inFlight = this.refreshing.get(serverId)
    if (inFlight) return inFlight
    const task = this.refreshAccessToken(serverId, token).finally(() => {
      this.refreshing.delete(serverId)
    })
    this.refreshing.set(serverId, task)
    return task
  }

  async getAuthorizationHeader(serverId: string): Promise<string | null> {
    const accessToken = await this.getValidAccessToken(serverId)
    return accessToken ? `Bearer ${accessToken}` : null
  }

  /**
   * Executes full OAuth 2.1 + PKCE interactive sign-in for a remote MCP server:
   * discovers metadata, starts an ephemeral localhost callback server, opens the
   * authorization URL in the user's browser, exchanges the authorization code, and
   * saves the tokens encrypted in the OS keychain.
   */
  async connect(serverId: string, serverUrl: string, serverName = 'MCP Server', resourceMetadataUrl?: string | null): Promise<McpOAuthConnectResult> {
    if (!this.isKeychainAvailable()) {
      return {
        ok: false,
        status: this.status(serverId),
        error: 'OS keychain encryption is unavailable; OAuth tokens cannot be stored securely.'
      }
    }

    try {
      const metadata = await discoverOAuthMetadata(serverUrl, {
        fetchImpl: this.fetchImpl,
        resourceMetadataUrl
      })
      const callback = await startLoopbackCallbackServer(this.callbackTimeoutMs)
      try {
        const clientId = await this.resolveClientId(metadata, callback.redirectUri)
        const pkce = generatePkcePair()
        const state = randomBytes(24).toString('base64url')

        const authUrl = new URL(metadata.authorizationEndpoint)
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('client_id', clientId)
        authUrl.searchParams.set('redirect_uri', callback.redirectUri)
        authUrl.searchParams.set('code_challenge', pkce.codeChallenge)
        authUrl.searchParams.set('code_challenge_method', pkce.method)
        authUrl.searchParams.set('state', state)
        if (metadata.resource) authUrl.searchParams.set('resource', metadata.resource)
        if (metadata.scopesSupported?.length) {
          authUrl.searchParams.set('scope', metadata.scopesSupported.join(' '))
        }

        const opened = this.openBrowser(authUrl.toString())
        if (!opened) {
          throw new Error('Could not open the browser for OAuth sign-in.')
        }

        const { code, state: returnedState } = await callback.waitForCode
        if (returnedState !== state) {
          throw new Error('OAuth state mismatch; sign-in aborted for security.')
        }

        const exchanged = await this.exchangeCode({
          tokenEndpoint: metadata.tokenEndpoint,
          code,
          redirectUri: callback.redirectUri,
          clientId,
          codeVerifier: pkce.codeVerifier,
          resource: metadata.resource
        })
        const stored: StoredMcpOAuthToken = {
          ...exchanged,
          tokenEndpoint: metadata.tokenEndpoint,
          clientId,
          authorizationServer: metadata.authorizationServer,
          resourceUrl: metadata.resource ?? serverUrl
        }
        this.saveToken(serverId, stored, `MCP OAuth (${serverName})`)
        return { ok: true, status: this.status(serverId) }
      } finally {
        callback.close()
      }
    } catch (err) {
      return {
        ok: false,
        status: this.status(serverId),
        error: err instanceof Error ? err.message : 'OAuth sign-in failed.'
      }
    }
  }

  private readToken(serverId: string): StoredMcpOAuthToken | null {
    if (!this.cipher || !this.cipher.available()) return null
    let row: { payload: Buffer; encrypted: number } | undefined
    try {
      row = this.db.prepare('SELECT payload, encrypted FROM secure_credentials WHERE provider = ?').get(oauthCredentialKey(serverId)) as { payload: Buffer; encrypted: number } | undefined
    } catch {
      return null
    }
    if (!row || row.encrypted !== 1) return null
    try {
      const plaintext = this.cipher.decrypt(Buffer.from(row.payload))
      const parsed = JSON.parse(plaintext) as Partial<StoredMcpOAuthToken>
      if (typeof parsed.accessToken !== 'string' || !parsed.accessToken) return null
      return {
        accessToken: parsed.accessToken,
        refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : undefined,
        tokenType: typeof parsed.tokenType === 'string' ? parsed.tokenType : 'Bearer',
        expiresAtMs: typeof parsed.expiresAtMs === 'number' ? parsed.expiresAtMs : null,
        scope: typeof parsed.scope === 'string' ? parsed.scope : null,
        tokenEndpoint: typeof parsed.tokenEndpoint === 'string' ? parsed.tokenEndpoint : null,
        clientId: typeof parsed.clientId === 'string' ? parsed.clientId : null,
        authorizationServer: typeof parsed.authorizationServer === 'string' ? parsed.authorizationServer : null,
        resourceUrl: typeof parsed.resourceUrl === 'string' ? parsed.resourceUrl : null
      }
    } catch {
      return null
    }
  }

  private async resolveClientId(metadata: OAuthDiscoveryMetadata, redirectUri: string): Promise<string> {
    if (!metadata.registrationEndpoint) return DEFAULT_CLIENT_ID
    try {
      const response = await this.fetchImpl(metadata.registrationEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_name: 'OXESpace',
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none'
        }),
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
      })
      if (!response.ok) return DEFAULT_CLIENT_ID
      const data = await response.json() as { client_id?: unknown }
      return typeof data.client_id === 'string' && data.client_id.trim() ? data.client_id.trim() : DEFAULT_CLIENT_ID
    } catch {
      return DEFAULT_CLIENT_ID
    }
  }

  private async exchangeCode(input: {
    tokenEndpoint: string
    code: string
    redirectUri: string
    clientId: string
    codeVerifier: string
    resource?: string
  }): Promise<Omit<StoredMcpOAuthToken, 'tokenEndpoint' | 'clientId' | 'authorizationServer' | 'resourceUrl'>> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      code_verifier: input.codeVerifier
    })
    if (input.resource) body.set('resource', input.resource)
    const response = await this.fetchImpl(validateMcpHttpUrl(input.tokenEndpoint).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS)
    })
    if (!response.ok) {
      throw new Error(`OAuth token exchange failed (HTTP ${response.status}).`)
    }
    return this.parseTokenResponse(await response.json())
  }

  private async refreshAccessToken(serverId: string, existing: StoredMcpOAuthToken): Promise<string | null> {
    if (!existing.refreshToken || !existing.tokenEndpoint) return existing.accessToken
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: existing.refreshToken,
      client_id: existing.clientId ?? DEFAULT_CLIENT_ID
    })
    if (existing.resourceUrl) body.set('resource', existing.resourceUrl)
    try {
      const response = await this.fetchImpl(validateMcpHttpUrl(existing.tokenEndpoint).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: body.toString(),
        signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS)
      })
      if (!response.ok) return null
      const refreshed = this.parseTokenResponse(await response.json())
      const next: StoredMcpOAuthToken = {
        ...existing,
        ...refreshed,
        refreshToken: refreshed.refreshToken ?? existing.refreshToken
      }
      this.saveToken(serverId, next)
      return next.accessToken
    } catch {
      return null
    }
  }

  private parseTokenResponse(raw: unknown): Omit<StoredMcpOAuthToken, 'tokenEndpoint' | 'clientId' | 'authorizationServer' | 'resourceUrl'> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('OAuth server returned an invalid token payload.')
    }
    const obj = raw as Record<string, unknown>
    if (typeof obj.access_token !== 'string' || !obj.access_token) {
      throw new Error('OAuth server did not return an access token.')
    }
    const expiresIn = typeof obj.expires_in === 'number' && Number.isFinite(obj.expires_in) && obj.expires_in > 0 ? obj.expires_in : null
    return {
      accessToken: obj.access_token,
      refreshToken: typeof obj.refresh_token === 'string' && obj.refresh_token ? obj.refresh_token : undefined,
      tokenType: typeof obj.token_type === 'string' && obj.token_type ? obj.token_type : 'Bearer',
      expiresAtMs: expiresIn !== null ? this.now() + expiresIn * 1000 : null,
      scope: typeof obj.scope === 'string' ? obj.scope : null
    }
  }
}

interface LoopbackCallback {
  redirectUri: string
  waitForCode: Promise<{ code: string; state: string }>
  close: () => void
}

function startLoopbackCallbackServer(timeoutMs: number): Promise<LoopbackCallback> {
  return new Promise((resolveStart, rejectStart) => {
    let settled = false
    let resolveCode!: (value: { code: string; state: string }) => void
    let rejectCode!: (err: Error) => void
    const waitForCode = new Promise<{ code: string; state: string }>((res, rej) => {
      resolveCode = res
      rejectCode = rej
    })

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (reqUrl.pathname !== '/oauth/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Not found')
        return
      }
      const error = reqUrl.searchParams.get('error')
      const code = reqUrl.searchParams.get('code')
      const state = reqUrl.searchParams.get('state') ?? ''
      res.writeHead(error ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        error
          ? '<!doctype html><meta charset="utf-8"><title>OXESpace</title><p>Sign-in was cancelled or denied. You may close this tab.</p>'
          : '<!doctype html><meta charset="utf-8"><title>OXESpace</title><p>Signed in to OXESpace. You may close this tab.</p>'
      )
      if (settled) return
      settled = true
      if (error) rejectCode(new Error(`OAuth sign-in denied: ${error}`))
      else if (!code) rejectCode(new Error('OAuth callback did not include an authorization code.'))
      else resolveCode({ code, state })
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      rejectCode(new Error('OAuth sign-in timed out waiting for browser callback.'))
    }, timeoutMs)

    const close = () => {
      clearTimeout(timer)
      try { server.close() } catch { /* ignore */ }
    }

    server.once('error', err => {
      clearTimeout(timer)
      rejectStart(err)
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo | null
      if (!addr) {
        close()
        rejectStart(new Error('Could not bind localhost OAuth callback port.'))
        return
      }
      resolveStart({
        redirectUri: `http://127.0.0.1:${addr.port}/oauth/callback`,
        waitForCode,
        close
      })
    })
  })
}
