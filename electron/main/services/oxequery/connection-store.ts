import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../../db'
import { CONNECTION_COLORS, type AgentAccess, type ConnectionColor, type ConnectionEnvironment, type DatabaseEngine, type MongoOptions, type OxeQueryConnection, type OxeQueryConnectionInput, type SshAuth, type SslMode } from '../../../../shared/types/oxequery'
import type { ResolvedConnection } from './oxequery-errors'
import { PickedFiles, assertPem } from './picked-files'

/** Encryption seam: Electron's safeStorage in the app, a fake in tests. */
export interface SecretCipher {
  available(): boolean
  /** Why secrets cannot be stored, when they cannot. */
  problem?(): string | null
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

interface Row {
  id: string; name: string; engine: DatabaseEngine; host: string; port: number; database_name: string; username: string
  ssl_mode: SslMode; read_only: number; environment: ConnectionEnvironment; container_ref: string | null; has_password: number
  created_at: number; updated_at: number
  has_ca: number; has_client_cert: number
  auth_source: string; replica_set: string; direct_connection: number; use_srv: number; extra_hosts: string
  ssh_enabled: number; ssh_host: string; ssh_port: number; ssh_user: string; ssh_auth: SshAuth; has_ssh_secret: number; ssh_key_name: string
  statement_timeout_ms: number; max_rows: number; agent_access: AgentAccess
  group_name: string; favorite: number; color: string; last_used_at: number; mask_patterns: string; keepalive_seconds: number; ssh_use_agent: number
}

export class ConnectionInputError extends Error {}

const ENGINES = new Set<DatabaseEngine>(['postgres', 'mongodb'])
const SSL = new Set<SslMode>(['disable', 'prefer', 'require', 'verify-ca', 'verify-full'])
const ENVIRONMENTS = new Set<ConnectionEnvironment>(['local', 'dev', 'prod'])
const AGENT = new Set<AgentAccess>(['off', 'read', 'write'])
const SSH_AUTH = new Set<SshAuth>(['key', 'password', 'agent'])
const COLORS = new Set<string>(CONNECTION_COLORS)
const MAX_MASK_PATTERNS = 20
const HOST_PATTERN = /^[^\s/\\@?#,]+$/
const key = (id: string, part = ''): string => `oxequery:${id}${part ? `:${part}` : ''}`

function toConnection(row: Row): OxeQueryConnection {
  return {
    id: row.id, name: row.name, engine: row.engine, host: row.host, port: row.port, database: row.database_name, username: row.username,
    sslMode: row.ssl_mode, readOnly: row.read_only === 1, environment: row.environment,
    ...(row.container_ref ? { containerRef: row.container_ref } : {}), hasPassword: row.has_password === 1,
    hasCa: row.has_ca === 1, hasClientCert: row.has_client_cert === 1,
    mongo: { authSource: row.auth_source, replicaSet: row.replica_set, directConnection: row.direct_connection === 1, srv: row.use_srv === 1, extraHosts: row.extra_hosts ? row.extra_hosts.split(',') : [] },
    ...(row.ssh_enabled === 1 ? { ssh: { host: row.ssh_host, port: row.ssh_port, user: row.ssh_user, auth: row.ssh_use_agent === 1 ? 'agent' as const : row.ssh_auth, hasSecret: row.has_ssh_secret === 1, ...(row.ssh_key_name ? { keyName: row.ssh_key_name } : {}) } } : {}),
    statementTimeoutMs: row.statement_timeout_ms, maxRows: row.max_rows, agentAccess: row.agent_access,
    group: row.group_name, favorite: row.favorite === 1, color: COLORS.has(row.color) ? row.color as ConnectionColor : '',
    maskPatterns: row.mask_patterns ? row.mask_patterns.split('\n') : [], lastUsedAt: row.last_used_at, keepaliveSeconds: row.keepalive_seconds,
    createdAt: row.created_at, updatedAt: row.updated_at
  }
}

function assertHost(value: string, label: string): string {
  const host = value.trim()
  if (!host || host.length > 255 || !HOST_PATTERN.test(host)) throw new ConnectionInputError(`Enter a valid ${label}.`)
  return host
}

function assertPort(value: unknown, label: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConnectionInputError(`The ${label} must be between 1 and 65535.`)
  return port
}

export interface NormalizedConnection {
  name: string; engine: DatabaseEngine; host: string; port: number; database: string; username: string
  sslMode: SslMode; readOnly: boolean; environment: ConnectionEnvironment; containerRef?: string
  mongo: MongoOptions
  ssh: { enabled: boolean; host: string; port: number; user: string; auth: SshAuth }
  statementTimeoutMs: number; maxRows: number; agentAccess: AgentAccess
  group: string; favorite: boolean; color: ConnectionColor | ''; maskPatterns: string[]; keepaliveSeconds: number
}

/** A folder name: plain text a person reads in a list. */
export function normalizeGroup(value: unknown): string {
  const group = String(value ?? '').trim().replace(/\s+/g, ' ')
  if (group.length > 60 || /[\0\n\r]/.test(group)) throw new ConnectionInputError('A group name can have up to 60 characters.')
  return group
}

/** Names the agent gateway masks: plain text, each at most 100 characters, a handful per connection. */
export function normalizeMaskPatterns(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new ConnectionInputError('Masked names must be a list.')
  const patterns = [...new Set(value.map(entry => String(entry).trim()).filter(Boolean))]
  if (patterns.length > MAX_MASK_PATTERNS) throw new ConnectionInputError(`At most ${MAX_MASK_PATTERNS} masked names are supported.`)
  if (patterns.some(entry => entry.length > 100 || /[\0\n\r]/.test(entry))) throw new ConnectionInputError('A masked name can have up to 100 characters on one line.')
  return patterns
}

/** Validated, trimmed values for a connection. Throws ConnectionInputError with a message fit for the UI. */
export function normalizeConnectionInput(input: OxeQueryConnectionInput): NormalizedConnection {
  const name = String(input.name ?? '').trim()
  if (!name || name.length > 80) throw new ConnectionInputError('Give the connection a name (up to 80 characters).')
  if (!ENGINES.has(input.engine)) throw new ConnectionInputError('Choose PostgreSQL or MongoDB.')
  const mongoInput = input.mongo ?? {}
  const srv = input.engine === 'mongodb' && mongoInput.srv === true
  const host = assertHost(String(input.host ?? ''), 'host name or address')
  // A mongodb+srv:// seed list is a DNS name; it has no port.
  const port = srv ? 27017 : assertPort(input.port, 'port')
  const database = String(input.database ?? '').trim()
  const username = String(input.username ?? '').trim()
  if (database.length > 255 || username.length > 255 || database.includes('\0') || username.includes('\0')) throw new ConnectionInputError('The database or user name is too long.')
  const sslMode = input.sslMode ?? 'disable'
  if (!SSL.has(sslMode)) throw new ConnectionInputError('Unsupported TLS mode.')
  const environment = input.environment ?? 'local'
  if (!ENVIRONMENTS.has(environment)) throw new ConnectionInputError('Unsupported environment.')
  const containerRef = input.containerRef?.trim()
  if (containerRef && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(containerRef)) throw new ConnectionInputError('Invalid container reference.')

  const extraHosts = (mongoInput.extraHosts ?? []).map(entry => String(entry).trim()).filter(Boolean)
  if (extraHosts.length > 8) throw new ConnectionInputError('At most 8 additional hosts are supported.')
  for (const entry of extraHosts) {
    const match = /^([^\s/\\@?#,:]+|\[[0-9a-fA-F:]+\]):(\d{1,5})$/.exec(entry)
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535) throw new ConnectionInputError(`"${entry}" is not a host:port.`)
  }
  const authSource = String(mongoInput.authSource ?? '').trim()
  const replicaSet = String(mongoInput.replicaSet ?? '').trim()
  if (/[\s&=?#]/.test(authSource) || /[\s&=?#]/.test(replicaSet) || authSource.length > 128 || replicaSet.length > 128) throw new ConnectionInputError('The auth source and replica set must be plain names.')
  if (srv && extraHosts.length) throw new ConnectionInputError('A mongodb+srv address resolves its own hosts; remove the additional hosts.')

  const sshInput = input.ssh
  const ssh = { enabled: sshInput?.enabled === true, host: '', port: 22, user: '', auth: (sshInput?.auth ?? 'key') as SshAuth }
  if (ssh.enabled) {
    ssh.host = assertHost(String(sshInput?.host ?? ''), 'SSH host')
    ssh.port = assertPort(sshInput?.port ?? 22, 'SSH port')
    ssh.user = String(sshInput?.user ?? '').trim()
    if (!ssh.user || ssh.user.length > 128 || /[\s\0]/.test(ssh.user)) throw new ConnectionInputError('Enter the SSH user name.')
    if (!SSH_AUTH.has(ssh.auth)) throw new ConnectionInputError('Unsupported SSH authentication.')
  }

  const statementTimeoutMs = input.statementTimeoutMs ?? 60_000
  if (!Number.isInteger(statementTimeoutMs) || statementTimeoutMs < 1000 || statementTimeoutMs > 3_600_000) throw new ConnectionInputError('The statement timeout must be between 1 second and 1 hour.')
  const maxRows = input.maxRows ?? 500
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 100_000) throw new ConnectionInputError('The row limit must be between 1 and 100 000.')
  const agentAccess = input.agentAccess ?? 'off'
  if (!AGENT.has(agentAccess)) throw new ConnectionInputError('Unsupported agent access level.')
  // Agents never write to production, whatever else is configured.
  if (environment === 'prod' && agentAccess === 'write') throw new ConnectionInputError('Agents cannot be given write access to a production connection.')
  const color = input.color ?? ''
  if (color !== '' && !COLORS.has(color)) throw new ConnectionInputError('Unsupported color.')
  const keepaliveSeconds = input.keepaliveSeconds ?? 30
  if (!Number.isInteger(keepaliveSeconds) || keepaliveSeconds < 0 || keepaliveSeconds > 3600) throw new ConnectionInputError('The keep-alive interval must be between 0 and 3600 seconds.')

  return {
    name, engine: input.engine, host, port, database, username, sslMode, readOnly: input.readOnly ?? true, environment,
    ...(containerRef ? { containerRef } : {}),
    mongo: { authSource, replicaSet, directConnection: mongoInput.directConnection ?? (!srv && extraHosts.length === 0 && replicaSet === ''), srv, extraHosts },
    ssh, statementTimeoutMs, maxRows, agentAccess,
    group: normalizeGroup(input.group), favorite: input.favorite === true, color, maskPatterns: normalizeMaskPatterns(input.maskPatterns), keepaliveSeconds
  }
}

/** Saved connections. Secrets go to `secure_credentials` and never come back out of this class except via resolve(). */
export class ConnectionStore {
  constructor(
    private readonly db: AppDatabase,
    private readonly cipher: SecretCipher,
    private readonly picked: PickedFiles = new PickedFiles()
  ) {}

  /** Connections made for this session only: never written to the database, secrets only in memory. */
  private readonly memory = new Map<string, { info: OxeQueryConnection; secrets: Record<string, string> }>()

  isEphemeral(id: string): boolean { return this.memory.has(id) }

  list(): OxeQueryConnection[] {
    return [
      ...(this.db.prepare('SELECT * FROM oxequery_connections ORDER BY name COLLATE NOCASE').all() as Row[]).map(toConnection),
      ...[...this.memory.values()].map(entry => entry.info)
    ]
  }

  /**
   * "Connect without saving": the same validation as a saved connection, kept in memory. It has no
   * history, saved queries or workspace (those belong to saved connections) and is gone when the app closes.
   */
  saveEphemeral(input: OxeQueryConnectionInput): OxeQueryConnection {
    if (this.memory.size >= 10) throw new ConnectionInputError('Close one of the unsaved connections first (up to 10 can be open).')
    const value = normalizeConnectionInput(input)
    const secrets: Record<string, string> = {}
    if (typeof input.password === 'string' && input.password.length > 0) {
      if (input.password.length > 1024) throw new ConnectionInputError('The password is too long.')
      secrets[''] = input.password
    }
    if (input.caHandle) {
      const file = this.picked.take(input.caHandle, 'ca')
      if (!file) throw new ConnectionInputError('The CA file selection expired. Choose the file again.')
      secrets.ca = assertPem(file.content, 'The CA file')
    }
    if (input.clientCertHandle || input.clientKeyHandle) {
      const cert = input.clientCertHandle ? this.picked.take(input.clientCertHandle, 'cert') : null
      const privateKey = input.clientKeyHandle ? this.picked.take(input.clientKeyHandle, 'key') : null
      if (!cert || !privateKey) throw new ConnectionInputError('Choose both the client certificate and its private key.')
      secrets.cert = assertPem(cert.content, 'The client certificate'); secrets.key = assertPem(privateKey.content, 'The client key')
    }
    let keyName = ''
    if (value.ssh.enabled && value.ssh.auth !== 'agent') {
      const sshInput = input.ssh!
      const secret: { password?: string; privateKey?: string; passphrase?: string } = {}
      if (value.ssh.auth === 'password' && sshInput.password) secret.password = sshInput.password
      if (value.ssh.auth === 'key' && sshInput.keyHandle) {
        const file = this.picked.take(sshInput.keyHandle, 'sshKey')
        if (!file) throw new ConnectionInputError('The SSH key selection expired. Choose the file again.')
        secret.privateKey = assertPem(file.content, 'The SSH key'); keyName = file.name.slice(0, 120)
        if (sshInput.passphrase) secret.passphrase = sshInput.passphrase
      }
      if (!secret.password && !secret.privateKey) throw new ConnectionInputError(value.ssh.auth === 'key' ? 'Choose the SSH private key file.' : 'Enter the SSH password.')
      secrets.ssh = JSON.stringify(secret)
    }
    const now = Date.now()
    const id = `tmp-${randomUUID()}`
    const info: OxeQueryConnection = {
      id, name: value.name, engine: value.engine, host: value.host, port: value.port, database: value.database, username: value.username, sslMode: value.sslMode,
      readOnly: value.readOnly, environment: value.environment, ...(value.containerRef ? { containerRef: value.containerRef } : {}),
      hasPassword: 'password' in secrets || '' in secrets, hasCa: 'ca' in secrets, hasClientCert: 'cert' in secrets, mongo: value.mongo,
      ...(value.ssh.enabled ? { ssh: { host: value.ssh.host, port: value.ssh.port, user: value.ssh.user, auth: value.ssh.auth, hasSecret: 'ssh' in secrets, ...(keyName ? { keyName } : {}) } } : {}),
      statementTimeoutMs: value.statementTimeoutMs, maxRows: value.maxRows, agentAccess: 'off', group: '', favorite: false, color: value.color,
      maskPatterns: value.maskPatterns, lastUsedAt: now, keepaliveSeconds: value.keepaliveSeconds, ephemeral: true, createdAt: now, updatedAt: now
    }
    this.memory.set(id, { info, secrets })
    return info
  }

  get(id: string): OxeQueryConnection {
    const unsaved = this.memory.get(id)
    if (unsaved) return unsaved.info
    const row = this.db.prepare('SELECT * FROM oxequery_connections WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new ConnectionInputError('That connection no longer exists.')
    return toConnection(row)
  }

  private putSecret(id: string, part: string, value: string, label: string, now: number): void {
    this.db.prepare(`INSERT INTO secure_credentials (provider, payload, encrypted, label, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET payload = excluded.payload, encrypted = 1, label = excluded.label, updated_at = excluded.updated_at`)
      .run(key(id, part), this.cipher.encrypt(value), label, now, now)
  }

  private dropSecret(id: string, part: string): void {
    this.db.prepare('DELETE FROM secure_credentials WHERE provider = ?').run(key(id, part))
  }

  private readSecret(id: string, part: string): string | undefined {
    const unsaved = this.memory.get(id)
    if (unsaved) return unsaved.secrets[part]
    const row = this.db.prepare('SELECT payload, encrypted FROM secure_credentials WHERE provider = ?').get(key(id, part)) as { payload: Buffer; encrypted: number } | undefined
    if (!row) return undefined
    return row.encrypted === 1 ? this.cipher.decrypt(Buffer.from(row.payload)) : Buffer.from(row.payload).toString('utf8')
  }

  save(input: OxeQueryConnectionInput): OxeQueryConnection {
    const value = normalizeConnectionInput(input)
    const now = Date.now()
    const existing = input.id ? this.db.prepare('SELECT * FROM oxequery_connections WHERE id = ?').get(input.id) as Row | undefined : undefined
    if (input.id && !existing) throw new ConnectionInputError('That connection no longer exists.')
    const id = existing?.id ?? randomUUID()

    const password = typeof input.password === 'string' && input.password.length > 0 ? input.password : undefined
    if (password && password.length > 1024) throw new ConnectionInputError('The password is too long.')

    // Everything that is a secret is gathered first, so a refusal leaves no partial write.
    const secrets: { part: string; value: string; label: string }[] = []
    const drops: string[] = []
    let hasPassword = existing?.has_password === 1
    let hasCa = existing?.has_ca === 1
    let hasClientCert = existing?.has_client_cert === 1
    let hasSshSecret = existing?.has_ssh_secret === 1
    let sshKeyName = existing?.ssh_key_name ?? ''

    if (input.clearPassword) { drops.push(''); hasPassword = false }
    if (password) { secrets.push({ part: '', value: password, label: value.name }); hasPassword = true }

    if (input.clearCa) { drops.push('ca'); hasCa = false }
    if (input.caHandle) {
      const file = this.picked.take(input.caHandle, 'ca')
      if (!file) throw new ConnectionInputError('The CA file selection expired. Choose the file again.')
      secrets.push({ part: 'ca', value: assertPem(file.content, 'The CA file'), label: `${value.name} CA` })
      hasCa = true
    }
    if (input.clearClientCert) { drops.push('cert', 'key'); hasClientCert = false }
    if (input.clientCertHandle || input.clientKeyHandle) {
      const cert = input.clientCertHandle ? this.picked.take(input.clientCertHandle, 'cert') : null
      const privateKey = input.clientKeyHandle ? this.picked.take(input.clientKeyHandle, 'key') : null
      if (!cert || !privateKey) throw new ConnectionInputError('Choose both the client certificate and its private key.')
      secrets.push({ part: 'cert', value: assertPem(cert.content, 'The client certificate'), label: `${value.name} client certificate` })
      secrets.push({ part: 'key', value: assertPem(privateKey.content, 'The client key'), label: `${value.name} client key` })
      hasClientCert = true
    }

    if (!value.ssh.enabled) {
      drops.push('ssh'); hasSshSecret = false; sshKeyName = ''
    } else {
      const sshInput = input.ssh!
      if (sshInput.clearSecret || value.ssh.auth === 'agent') { drops.push('ssh'); hasSshSecret = false; sshKeyName = '' }
      const secret: { password?: string; privateKey?: string; passphrase?: string } = {}
      if (value.ssh.auth === 'password' && sshInput.password) secret.password = sshInput.password
      if (value.ssh.auth === 'key' && sshInput.keyHandle) {
        const file = this.picked.take(sshInput.keyHandle, 'sshKey')
        if (!file) throw new ConnectionInputError('The SSH key selection expired. Choose the file again.')
        secret.privateKey = assertPem(file.content, 'The SSH key')
        sshKeyName = file.name.slice(0, 120)
        if (sshInput.passphrase) secret.passphrase = sshInput.passphrase
      }
      if (secret.password || secret.privateKey) { secrets.push({ part: 'ssh', value: JSON.stringify(secret), label: `${value.name} SSH` }); hasSshSecret = true }
      else if (!hasSshSecret && value.ssh.auth !== 'agent') throw new ConnectionInputError(value.ssh.auth === 'key' ? 'Choose the SSH private key file.' : 'Enter the SSH password.')
      // Switching the method invalidates the other kind of secret.
      if (existing && value.ssh.auth !== 'agent' && (existing.ssh_use_agent === 1 || existing.ssh_auth !== value.ssh.auth) && !secrets.some(entry => entry.part === 'ssh')) throw new ConnectionInputError(value.ssh.auth === 'key' ? 'Choose the SSH private key file.' : 'Enter the SSH password.')
    }

    if (secrets.length && !this.cipher.available()) {
      throw new ConnectionInputError(this.cipher.problem?.() ?? 'Secure storage is unavailable on this system, so passwords, keys and certificates cannot be saved. Use a connection that does not need them.')
    }
    if ((value.sslMode === 'verify-ca') && !hasCa && !secrets.some(entry => entry.part === 'ca')) {
      // The system trust store may be enough for a public CA, so this is allowed but not silent.
    }

    this.db.transaction(() => {
      for (const part of drops) if (!secrets.some(entry => entry.part === part)) this.dropSecret(id, part)
      for (const entry of secrets) this.putSecret(id, entry.part, entry.value, entry.label, now)
      this.db.prepare(`INSERT INTO oxequery_connections (id, name, engine, host, port, database_name, username, ssl_mode, read_only, environment, container_ref, has_password, created_at, updated_at,
          has_ca, has_client_cert, auth_source, replica_set, direct_connection, use_srv, extra_hosts, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_auth, has_ssh_secret, ssh_key_name,
          statement_timeout_ms, max_rows, agent_access, group_name, favorite, color, mask_patterns, keepalive_seconds, ssh_use_agent)
        VALUES (@id, @name, @engine, @host, @port, @database, @username, @sslMode, @readOnly, @environment, @containerRef, @hasPassword, @now, @now,
          @hasCa, @hasClientCert, @authSource, @replicaSet, @directConnection, @srv, @extraHosts, @sshEnabled, @sshHost, @sshPort, @sshUser, @sshAuth, @hasSshSecret, @sshKeyName,
          @statementTimeoutMs, @maxRows, @agentAccess, @group, @favorite, @color, @maskPatterns, @keepaliveSeconds, @sshUseAgent)
        ON CONFLICT(id) DO UPDATE SET name = @name, engine = @engine, host = @host, port = @port, database_name = @database, username = @username, ssl_mode = @sslMode,
          read_only = @readOnly, environment = @environment, container_ref = @containerRef, has_password = @hasPassword, updated_at = @now,
          has_ca = @hasCa, has_client_cert = @hasClientCert, auth_source = @authSource, replica_set = @replicaSet, direct_connection = @directConnection, use_srv = @srv,
          extra_hosts = @extraHosts, ssh_enabled = @sshEnabled, ssh_host = @sshHost, ssh_port = @sshPort, ssh_user = @sshUser, ssh_auth = @sshAuth,
          has_ssh_secret = @hasSshSecret, ssh_key_name = @sshKeyName, statement_timeout_ms = @statementTimeoutMs, max_rows = @maxRows, agent_access = @agentAccess,
          group_name = @group, favorite = @favorite, color = @color, mask_patterns = @maskPatterns, keepalive_seconds = @keepaliveSeconds, ssh_use_agent = @sshUseAgent`)
        .run({
          id, name: value.name, engine: value.engine, host: value.host, port: value.port, database: value.database, username: value.username, sslMode: value.sslMode,
          readOnly: value.readOnly ? 1 : 0, environment: value.environment, containerRef: value.containerRef ?? null, hasPassword: hasPassword ? 1 : 0, now,
          hasCa: hasCa ? 1 : 0, hasClientCert: hasClientCert ? 1 : 0, authSource: value.mongo.authSource, replicaSet: value.mongo.replicaSet,
          directConnection: value.mongo.directConnection ? 1 : 0, srv: value.mongo.srv ? 1 : 0, extraHosts: value.mongo.extraHosts.join(','),
          sshEnabled: value.ssh.enabled ? 1 : 0, sshHost: value.ssh.host, sshPort: value.ssh.port, sshUser: value.ssh.user, sshAuth: value.ssh.auth === 'agent' ? 'key' : value.ssh.auth, sshUseAgent: value.ssh.auth === 'agent' ? 1 : 0,
          group: value.group, favorite: value.favorite ? 1 : 0, color: value.color, maskPatterns: value.maskPatterns.join('\n'), keepaliveSeconds: value.keepaliveSeconds,
          hasSshSecret: hasSshSecret ? 1 : 0, sshKeyName, statementTimeoutMs: value.statementTimeoutMs, maxRows: value.maxRows, agentAccess: value.agentAccess
        })
    })()
    return this.get(id)
  }

  /** Group, favorite and color change without sending the whole form (and without touching secrets). */
  update(id: string, patch: { group?: string; favorite?: boolean; color?: string }): OxeQueryConnection {
    if (this.memory.has(id)) throw new ConnectionInputError('Save this connection first to organize it.')
    const current = this.get(id)
    const group = patch.group === undefined ? current.group : normalizeGroup(patch.group)
    const color = patch.color === undefined ? current.color : patch.color
    if (color !== '' && !COLORS.has(color)) throw new ConnectionInputError('Unsupported color.')
    this.db.prepare('UPDATE oxequery_connections SET group_name = ?, favorite = ?, color = ? WHERE id = ?').run(group, (patch.favorite ?? current.favorite) ? 1 : 0, color, id)
    return this.get(id)
  }

  /** Remembers that a connection was just used, for the "recent" list. Once a minute at most. */
  touch(id: string, now = Date.now()): void {
    if (this.memory.has(id)) return
    this.db.prepare('UPDATE oxequery_connections SET last_used_at = ? WHERE id = ? AND last_used_at < ?').run(now, id, now - 60_000)
  }

  /** A copy with its own id and its own copies of the secrets. The name says it is a copy. */
  duplicate(id: string): OxeQueryConnection {
    if (this.memory.has(id)) throw new ConnectionInputError('Save this connection first to copy it.')
    const source = this.db.prepare('SELECT * FROM oxequery_connections WHERE id = ?').get(id) as Row | undefined
    if (!source) throw new ConnectionInputError('That connection no longer exists.')
    const copyId = randomUUID()
    const now = Date.now()
    const name = `${source.name.slice(0, 70)} copy`
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO oxequery_connections (id, name, engine, host, port, database_name, username, ssl_mode, read_only, environment, container_ref, has_password, created_at, updated_at,
          has_ca, has_client_cert, auth_source, replica_set, direct_connection, use_srv, extra_hosts, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_auth, has_ssh_secret, ssh_key_name,
          statement_timeout_ms, max_rows, agent_access, group_name, favorite, color, mask_patterns, keepalive_seconds, ssh_use_agent, last_used_at)
        SELECT ?, ?, engine, host, port, database_name, username, ssl_mode, read_only, environment, container_ref, has_password, ?, ?,
          has_ca, has_client_cert, auth_source, replica_set, direct_connection, use_srv, extra_hosts, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_auth, has_ssh_secret, ssh_key_name,
          statement_timeout_ms, max_rows, agent_access, group_name, 0, color, mask_patterns, keepalive_seconds, ssh_use_agent, 0
        FROM oxequery_connections WHERE id = ?`).run(copyId, name, now, now, id)
      for (const part of ['', 'ca', 'cert', 'key', 'ssh']) {
        const secret = this.readSecret(id, part)
        if (secret !== undefined) this.putSecret(copyId, part, secret, `${name}${part ? ` ${part}` : ''}`, now)
      }
    })()
    return this.get(copyId)
  }

  delete(id: string): void {
    if (this.memory.delete(id)) return
    this.db.transaction(() => {
      for (const part of ['', 'ca', 'cert', 'key', 'ssh']) this.dropSecret(id, part)
      this.db.prepare('DELETE FROM oxequery_connections WHERE id = ?').run(id)
    })()
  }

  /** The only path that returns secrets, and only to code that talks to the database. */
  resolve(id: string): ResolvedConnection {
    const connection = this.get(id)
    const password = connection.hasPassword ? this.readSecret(id, '') : undefined
    const ca = connection.hasCa ? this.readSecret(id, 'ca') : undefined
    const cert = connection.hasClientCert ? this.readSecret(id, 'cert') : undefined
    const privateKey = connection.hasClientCert ? this.readSecret(id, 'key') : undefined
    let ssh: ResolvedConnection['ssh']
    if (connection.ssh) {
      const secret = connection.ssh.hasSecret ? JSON.parse(this.readSecret(id, 'ssh') ?? '{}') as { password?: string; privateKey?: string; passphrase?: string } : {}
      const pinned = this.db.prepare('SELECT fingerprint FROM oxequery_known_hosts WHERE host = ? AND port = ?').get(connection.ssh.host.toLowerCase(), connection.ssh.port) as { fingerprint: string } | undefined
      ssh = { host: connection.ssh.host, port: connection.ssh.port, user: connection.ssh.user, ...secret, ...(connection.ssh.auth === 'agent' ? { agent: true } : {}), ...(pinned ? { pinnedFingerprint: pinned.fingerprint } : {}) }
    }
    return {
      id: connection.id, engine: connection.engine, host: connection.host, port: connection.port, database: connection.database, username: connection.username,
      ...(password ? { password } : {}), sslMode: connection.sslMode, readOnly: connection.readOnly, environment: connection.environment,
      ...(ca || cert ? { tls: { ...(ca ? { ca } : {}), ...(cert && privateKey ? { cert, key: privateKey } : {}) } } : {}),
      mongo: connection.mongo, ...(ssh ? { ssh } : {}),
      statementTimeoutMs: connection.statementTimeoutMs, maxRows: connection.maxRows, keepaliveSeconds: connection.keepaliveSeconds
    }
  }

  trustHostKey(host: string, port: number, fingerprint: string): void {
    if (!/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(fingerprint)) throw new ConnectionInputError('That is not a valid host key fingerprint.')
    // Never overwrite a different key: a changed key must be investigated, not clicked through.
    const existing = this.db.prepare('SELECT fingerprint FROM oxequery_known_hosts WHERE host = ? AND port = ?').get(host.toLowerCase(), port) as { fingerprint: string } | undefined
    if (existing && existing.fingerprint !== fingerprint) throw new ConnectionInputError('A different host key is already trusted for this server. Remove the old one first.')
    this.db.prepare('INSERT OR IGNORE INTO oxequery_known_hosts (host, port, fingerprint, first_seen) VALUES (?, ?, ?, ?)').run(host.toLowerCase(), port, fingerprint, Date.now())
  }

  forgetHostKey(host: string, port: number): void {
    this.db.prepare('DELETE FROM oxequery_known_hosts WHERE host = ? AND port = ?').run(host.toLowerCase(), port)
  }

  knownHosts(): { host: string; port: number; fingerprint: string; firstSeen: number }[] {
    return (this.db.prepare('SELECT host, port, fingerprint, first_seen FROM oxequery_known_hosts ORDER BY host, port').all() as { host: string; port: number; fingerprint: string; first_seen: number }[])
      .map(row => ({ host: row.host, port: row.port, fingerprint: row.fingerprint, firstSeen: row.first_seen }))
  }
}
