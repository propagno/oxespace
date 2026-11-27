import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { WorkspaceAccessLevel } from '../../../shared/access-ceiling'
import type { SecretCipher } from './oxequery/connection-store'

export interface PersistedExecutionBinding {
  id: string
  paneId: string
  owner: { kind: 'pane'; id: string }
  workspaceId: string
  cwd: string
  canonicalRoot: string
  generation: number
  token: string
  access?: WorkspaceAccessLevel
}

export interface ExecutionBindingStoreOptions {
  filePath: string
  cipher?: SecretCipher
}

interface EncryptedEnvelope {
  version: 1
  encrypted: true
  payload: string
}

/**
 * OXE-447 · Persists active pane execution bindings (`paneId -> executionId/token/workspaceId`)
 * so detached PTY daemon sessions keep working with local RPC/MCP after an app restart.
 *
 * Security invariants:
 * - Tokens are NEVER written in plaintext: requires an available `SecretCipher` (`safeStorage`).
 * - Stored atomically (`temp` + `rename`) with owner-only mode `0600`.
 * - Corrupt or unreadable files degrade to `[]` so app boot is never blocked.
 */
export class ExecutionBindingStore {
  private readonly filePath: string
  private readonly cipher?: SecretCipher

  constructor(options: ExecutionBindingStoreOptions) {
    this.filePath = options.filePath
    this.cipher = options.cipher
  }

  load(): PersistedExecutionBinding[] {
    if (!this.cipher || !this.cipher.available()) return []
    let raw: string
    try {
      raw = readFileSync(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      return []
    }
    try {
      const envelope = JSON.parse(raw) as Partial<EncryptedEnvelope>
      if (envelope.version !== 1 || envelope.encrypted !== true || typeof envelope.payload !== 'string') return []
      const decrypted = this.cipher.decrypt(Buffer.from(envelope.payload, 'base64'))
      const parsed = JSON.parse(decrypted) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isValidBinding)
    } catch {
      return []
    }
  }

  save(bindings: readonly PersistedExecutionBinding[]): void {
    if (!this.cipher || !this.cipher.available()) return
    const paneBindings = bindings.filter(isValidBinding)
    const encrypted = this.cipher.encrypt(JSON.stringify(paneBindings))
    const envelope: EncryptedEnvelope = {
      version: 1,
      encrypted: true,
      payload: encrypted.toString('base64')
    }
    mkdirSync(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.${randomBytes(8).toString('hex')}.tmp`
    writeFileSync(temp, `${JSON.stringify(envelope)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(temp, this.filePath)
  }
}

function isValidBinding(value: unknown): value is PersistedExecutionBinding {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PersistedExecutionBinding>
  return (
    typeof item.id === 'string' && item.id.length > 0 &&
    typeof item.paneId === 'string' && item.paneId.length > 0 &&
    typeof item.workspaceId === 'string' && item.workspaceId.length > 0 &&
    typeof item.cwd === 'string' && item.cwd.length > 0 &&
    typeof item.canonicalRoot === 'string' && item.canonicalRoot.length > 0 &&
    typeof item.generation === 'number' && Number.isInteger(item.generation) && item.generation > 0 &&
    typeof item.token === 'string' && item.token.length >= 32 &&
    Boolean(item.owner && item.owner.kind === 'pane' && item.owner.id === item.paneId)
  )
}
