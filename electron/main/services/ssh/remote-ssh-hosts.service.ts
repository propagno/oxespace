import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { AppDatabase } from '../../db'
import type { RemoteSshAuthType, RemoteSshHost, RemoteSshHostInput } from '../../../../shared/types/remote-hosts'
import type { SecretCipher } from '../oxequery/connection-store'
import { probeSshHostKey, type SshConnectionConfig } from './ssh-client.service'
import { parseSshConfig, readUserSshConfig } from './ssh-config-parser'

const MAX_KEY_FILE_BYTES = 64 * 1024
const VALID_AUTH_TYPES = new Set<RemoteSshAuthType>(['key', 'password', 'agent'])
const HOST_PATTERN = /^[^\s/\\@?#,]+$/
const FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]+={0,2}$/

interface RemoteSshHostRow {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth_type: RemoteSshAuthType
  key_path: string | null
  encrypted_secret: Buffer | null
  pinned_fingerprint: string | null
  default_remote_dir: string | null
  created_at: number
  updated_at: number
}

export interface RemoteSshHostsServiceOptions {
  probe?: typeof probeSshHostKey
  readKeyFile?: (keyPath: string) => Buffer
}

function toPublicHost(row: RemoteSshHostRow): RemoteSshHost {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.auth_type,
    keyPath: row.key_path,
    hasSecret: row.encrypted_secret !== null && row.encrypted_secret.byteLength > 0,
    pinnedFingerprint: row.pinned_fingerprint,
    defaultRemoteDir: row.default_remote_dir,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function normalizePort(port: number | undefined): number {
  const value = port ?? 22
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('SSH port must be an integer between 1 and 65535')
  }
  return value
}

function normalizeHost(host: string): string {
  const value = host.trim()
  if (!value || !HOST_PATTERN.test(value)) {
    throw new Error('Invalid SSH host name or IP address')
  }
  return value
}

function normalizeFingerprint(fingerprint: string | null | undefined): string | null {
  if (!fingerprint || !fingerprint.trim()) return null
  const value = fingerprint.trim().replace(/=+$/, '')
  if (!FINGERPRINT_PATTERN.test(value)) {
    throw new Error('Invalid SHA-256 SSH host key fingerprint')
  }
  return value
}

function readBoundedKeyFile(keyPath: string): Buffer {
  const content = readFileSync(keyPath)
  if (content.byteLength > MAX_KEY_FILE_BYTES) {
    throw new Error('SSH private key file exceeds 64 KiB safety limit')
  }
  return content
}

/**
 * OXE-447 · Persists and resolves user-configured Remote SSH Hosts in SQLite (`remote_ssh_hosts`).
 *
 * Security invariants:
 * - Secrets are encrypted via `SecretCipher` (`safeStorage`) and NEVER stored in plaintext.
 * - Public methods (`list`, `get`, `create`, `update`, `pinFingerprint`, `importFromSshConfig`)
 *   NEVER return plaintext secrets.
 * - TOFU host key pinning is enforced before authentication via `pinnedFingerprint`.
 */
export class RemoteSshHostsService {
  private readonly probe: typeof probeSshHostKey
  private readonly readKeyFile: (keyPath: string) => Buffer

  constructor(
    private readonly db: AppDatabase,
    private readonly cipher: SecretCipher,
    options: RemoteSshHostsServiceOptions = {}
  ) {
    this.probe = options.probe ?? probeSshHostKey
    this.readKeyFile = options.readKeyFile ?? readBoundedKeyFile
  }

  list(): RemoteSshHost[] {
    const rows = this.db
      .prepare('SELECT * FROM remote_ssh_hosts ORDER BY name COLLATE NOCASE ASC, created_at ASC')
      .all() as RemoteSshHostRow[]
    return rows.map(toPublicHost)
  }

  get(id: string): RemoteSshHost | null {
    const row = this.db.prepare('SELECT * FROM remote_ssh_hosts WHERE id = ?').get(id) as RemoteSshHostRow | undefined
    return row ? toPublicHost(row) : null
  }

  create(input: RemoteSshHostInput): RemoteSshHost {
    const name = input.name.trim()
    if (!name) throw new Error('Host display name is required')
    const host = normalizeHost(input.host)
    const port = normalizePort(input.port)
    const username = input.username.trim()
    if (!username) throw new Error('SSH username is required')
    if (!VALID_AUTH_TYPES.has(input.authType)) throw new Error('Invalid SSH auth type')

    const encryptedSecret = this.encryptOptionalSecret(input.secret)
    const pinnedFingerprint = normalizeFingerprint(input.pinnedFingerprint)
    const keyPath = input.keyPath?.trim() || null
    const defaultRemoteDir = input.defaultRemoteDir?.trim() || null
    const now = Date.now()
    const id = randomUUID()

    this.db.prepare(`
      INSERT INTO remote_ssh_hosts (
        id, name, host, port, username, auth_type, key_path, encrypted_secret,
        pinned_fingerprint, default_remote_dir, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, name, host, port, username, input.authType, keyPath, encryptedSecret,
      pinnedFingerprint, defaultRemoteDir, now, now
    )

    return this.get(id)!
  }

  update(id: string, patch: Partial<RemoteSshHostInput>): RemoteSshHost {
    const existing = this.db.prepare('SELECT * FROM remote_ssh_hosts WHERE id = ?').get(id) as RemoteSshHostRow | undefined
    if (!existing) throw new Error(`Remote SSH host ${id} not found`)

    const name = patch.name !== undefined ? patch.name.trim() : existing.name
    if (!name) throw new Error('Host display name is required')
    const host = patch.host !== undefined ? normalizeHost(patch.host) : existing.host
    const port = patch.port !== undefined ? normalizePort(patch.port) : existing.port
    const username = patch.username !== undefined ? patch.username.trim() : existing.username
    if (!username) throw new Error('SSH username is required')
    const authType = patch.authType !== undefined ? patch.authType : existing.auth_type
    if (!VALID_AUTH_TYPES.has(authType)) throw new Error('Invalid SSH auth type')
    const keyPath = patch.keyPath !== undefined ? (patch.keyPath?.trim() || null) : existing.key_path
    const defaultRemoteDir = patch.defaultRemoteDir !== undefined
      ? (patch.defaultRemoteDir?.trim() || null)
      : existing.default_remote_dir
    const pinnedFingerprint = patch.pinnedFingerprint !== undefined
      ? normalizeFingerprint(patch.pinnedFingerprint)
      : existing.pinned_fingerprint

    let encryptedSecret = existing.encrypted_secret
    if (patch.secret !== undefined) {
      encryptedSecret = patch.secret === null || patch.secret === ''
        ? null
        : this.encryptOptionalSecret(patch.secret)
    }

    this.db.prepare(`
      UPDATE remote_ssh_hosts
      SET name = ?, host = ?, port = ?, username = ?, auth_type = ?, key_path = ?,
          encrypted_secret = ?, pinned_fingerprint = ?, default_remote_dir = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name, host, port, username, authType, keyPath,
      encryptedSecret, pinnedFingerprint, defaultRemoteDir, Date.now(), id
    )

    return this.get(id)!
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM remote_ssh_hosts WHERE id = ?').run(id)
  }

  async probeHostKey(target: { host: string; port?: number }): Promise<string> {
    return this.probe({ host: normalizeHost(target.host), port: normalizePort(target.port) })
  }

  pinFingerprint(id: string, fingerprint: string): RemoteSshHost {
    const normalized = normalizeFingerprint(fingerprint)
    if (!normalized) throw new Error('SSH host key fingerprint is required')
    const existing = this.get(id)
    if (!existing) throw new Error(`Remote SSH host ${id} not found`)
    this.db
      .prepare('UPDATE remote_ssh_hosts SET pinned_fingerprint = ?, updated_at = ? WHERE id = ?')
      .run(normalized, Date.now(), id)
    return this.get(id)!
  }

  /**
   * Idempotently imports host definitions from `~/.ssh/config` (or provided config text).
   * Never duplicates existing hosts and never overwrites already-pinned fingerprints.
   */
  importFromSshConfig(content?: string, homeDir?: string): { imported: RemoteSshHost[]; skipped: number } {
    const raw = content !== undefined ? content : readUserSshConfig(homeDir)
    const parsed = parseSshConfig(raw, homeDir)
    const existing = this.list()
    const existingByEndpoint = new Set(
      existing.map(item => `${item.host.toLowerCase()}:${item.port}:${item.username}`)
    )
    const existingByName = new Set(existing.map(item => item.name.toLowerCase()))

    const imported: RemoteSshHost[] = []
    let skipped = 0

    for (const candidate of parsed) {
      const endpointKey = `${candidate.host.toLowerCase()}:${candidate.port}:${candidate.username}`
      if (existingByEndpoint.has(endpointKey) || existingByName.has(candidate.name.toLowerCase())) {
        skipped += 1
        continue
      }
      const created = this.create({
        name: candidate.name,
        host: candidate.host,
        port: candidate.port,
        username: candidate.username,
        authType: candidate.authType,
        keyPath: candidate.keyPath
      })
      existingByEndpoint.add(endpointKey)
      existingByName.add(created.name.toLowerCase())
      imported.push(created)
    }

    return { imported, skipped }
  }

  /** Resolves decrypted connection credentials internally in main for `connectSshClient` / `SshHostedPty`. */
  resolveConnectionConfig(id: string): SshConnectionConfig {
    const row = this.db.prepare('SELECT * FROM remote_ssh_hosts WHERE id = ?').get(id) as RemoteSshHostRow | undefined
    if (!row) throw new Error(`Remote SSH host ${id} not found`)

    let secret: string | undefined
    if (row.encrypted_secret && row.encrypted_secret.byteLength > 0) {
      if (!this.cipher.available()) {
        throw new Error(this.cipher.problem?.() ?? 'Secure storage is unavailable to decrypt SSH credentials.')
      }
      secret = this.cipher.decrypt(row.encrypted_secret)
    }

    const config: SshConnectionConfig = {
      host: row.host,
      port: row.port,
      username: row.username,
      authType: row.auth_type,
      ...(row.pinned_fingerprint ? { pinnedFingerprint: row.pinned_fingerprint } : {})
    }

    if (row.auth_type === 'password') {
      if (secret !== undefined) config.password = secret
    } else if (row.auth_type === 'key') {
      if (!row.key_path) throw new Error(`SSH host "${row.name}" is missing its private key path`)
      config.privateKey = this.readKeyFile(row.key_path)
      if (secret !== undefined) config.passphrase = secret
    } else {
      config.agent = true
    }

    return config
  }

  private encryptOptionalSecret(secret: string | null | undefined): Buffer | null {
    if (!secret) return null
    if (!this.cipher.available()) {
      throw new Error(this.cipher.problem?.() ?? 'Secure storage is unavailable; refusing to store SSH secrets in plaintext.')
    }
    return this.cipher.encrypt(secret)
  }
}
