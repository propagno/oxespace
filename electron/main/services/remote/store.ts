import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../../db'
import { REMOTE_LIMITS } from '../../../../shared/remote/protocol'

export const REMOTE_DEFAULT_PORT = 47_321
export const REMOTE_AUDIT_RETENTION_DAYS = 90

export interface DeviceRecord {
  deviceId: string
  name: string
  publicKey: Buffer
  pairedAt: number
  lastSeenAt: number | null
  revoked: boolean
}

export interface GatewaySettings {
  port: number
  certificateDer: Buffer | null
  /** `safeStorage` ciphertext of the certificate's PKCS#8 PEM key. */
  certificateKey: Buffer | null
  /** The name phones see, or null for the default. */
  desktopName: string | null
}

export type RemoteAuditAction = 'enable' | 'disable' | 'pairing-start' | 'pairing-cancel' | 'pairing' | 'revoke' | 'rename' | 'desktop-name' | 'auth-failure' | 'certificate'
  | 'command' | 'phone-write'

export interface RemoteAuditRecord {
  action: RemoteAuditAction
  outcome: string
  deviceId?: string | null
  remoteAddress?: string | null
  /** A short, secret-free note (an error code, a port). */
  detail?: string | null
}

export class TooManyDevicesError extends Error {
  constructor() { super('Too many paired devices') }
}

interface DeviceRow { device_id: string; name: string; public_key_spki: Buffer; paired_at: number; last_seen_at: number | null; revoked: number }

const toDevice = (row: DeviceRow): DeviceRecord => ({
  deviceId: row.device_id, name: row.name, publicKey: Buffer.from(row.public_key_spki), pairedAt: row.paired_at, lastSeenAt: row.last_seen_at, revoked: row.revoked === 1
})

/** The gateway's persistent state: paired devices, its settings and secrets (as ciphertext), and its audit trail. */
export class RemoteStore {
  constructor(private readonly db: AppDatabase, private readonly now: () => number = Date.now) {}

  settings(): GatewaySettings {
    const row = this.db.prepare('SELECT port, certificate_der, certificate_key, desktop_name FROM remote_gateway WHERE id = 1').get() as
      { port: number; certificate_der: Buffer | null; certificate_key: Buffer | null; desktop_name: string | null } | undefined
    return { port: row?.port ?? REMOTE_DEFAULT_PORT, certificateDer: row?.certificate_der ?? null, certificateKey: row?.certificate_key ?? null, desktopName: row?.desktop_name ?? null }
  }

  savePort(port: number): void {
    this.db.prepare(`INSERT INTO remote_gateway (id, port, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET port = excluded.port, updated_at = excluded.updated_at`).run(port, this.now())
  }

  saveDesktopName(name: string | null): void {
    this.db.prepare(`INSERT INTO remote_gateway (id, desktop_name, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET desktop_name = excluded.desktop_name, updated_at = excluded.updated_at`).run(name, this.now())
  }

  /** The certificate and its key (already `safeStorage` ciphertext). */
  saveCertificate(certificate: { der: Buffer; encryptedKey: Buffer }): void {
    this.db.prepare(`INSERT INTO remote_gateway (id, certificate_der, certificate_key, updated_at) VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET certificate_der = excluded.certificate_der, certificate_key = excluded.certificate_key, updated_at = excluded.updated_at`)
      .run(certificate.der, certificate.encryptedKey, this.now())
  }

  /** Paired devices that are not revoked, oldest first. */
  devices(): DeviceRecord[] {
    return (this.db.prepare('SELECT * FROM remote_devices WHERE revoked = 0 ORDER BY paired_at, device_id').all() as DeviceRow[]).map(toDevice)
  }

  /** Any device, revoked or not, so a revoked one can be told so. */
  device(deviceId: string): DeviceRecord | undefined {
    const row = this.db.prepare('SELECT * FROM remote_devices WHERE device_id = ?').get(deviceId) as DeviceRow | undefined
    return row ? toDevice(row) : undefined
  }

  activeCount(): number {
    return (this.db.prepare('SELECT count(*) AS n FROM remote_devices WHERE revoked = 0').get() as { n: number }).n
  }

  /** Adds a device unless the limit is reached, in one transaction so two pairings cannot both pass the check. */
  addDevice(name: string, publicKey: Buffer): DeviceRecord {
    return this.db.transaction(() => {
      if (this.activeCount() >= REMOTE_LIMITS.maxDevices) throw new TooManyDevicesError()
      const device: DeviceRecord = { deviceId: randomUUID(), name, publicKey, pairedAt: this.now(), lastSeenAt: this.now(), revoked: false }
      this.db.prepare('INSERT INTO remote_devices (device_id, name, public_key_spki, paired_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
        .run(device.deviceId, device.name, device.publicKey, device.pairedAt, device.lastSeenAt)
      return device
    })()
  }

  rename(deviceId: string, name: string): DeviceRecord | undefined {
    const changes = this.db.prepare('UPDATE remote_devices SET name = ? WHERE device_id = ? AND revoked = 0').run(name, deviceId).changes
    return changes ? this.device(deviceId) : undefined
  }

  revoke(deviceId: string): boolean {
    return this.db.prepare('UPDATE remote_devices SET revoked = 1, revoked_at = ? WHERE device_id = ? AND revoked = 0').run(this.now(), deviceId).changes > 0
  }

  /** Every device, when the certificate they pinned is replaced. */
  revokeAll(): number {
    return this.db.prepare('UPDATE remote_devices SET revoked = 1, revoked_at = ? WHERE revoked = 0').run(this.now()).changes
  }

  touch(deviceId: string, at = this.now()): void {
    this.db.prepare('UPDATE remote_devices SET last_seen_at = ? WHERE device_id = ? AND revoked = 0').run(at, deviceId)
  }

  /** Append-only and best effort: a failed write never changes what is being recorded. */
  audit(entry: RemoteAuditRecord): void {
    try {
      this.db.prepare('INSERT INTO remote_audit (ts, action, outcome, device_id, remote_address, detail) VALUES (?, ?, ?, ?, ?, ?)')
        .run(this.now(), entry.action, entry.outcome.slice(0, 64), entry.deviceId ?? null, entry.remoteAddress?.slice(0, 64) ?? null, entry.detail?.slice(0, 200) ?? null)
    } catch { /* the trail is best effort */ }
  }

  auditEntries(limit = 100): Array<{ ts: number; action: string; outcome: string; deviceId: string | null; remoteAddress: string | null; detail: string | null }> {
    const rows = this.db.prepare('SELECT ts, action, outcome, device_id, remote_address, detail FROM remote_audit ORDER BY id DESC LIMIT ?').all(limit) as
      Array<{ ts: number; action: string; outcome: string; device_id: string | null; remote_address: string | null; detail: string | null }>
    return rows.map(row => ({ ts: row.ts, action: row.action, outcome: row.outcome, deviceId: row.device_id, remoteAddress: row.remote_address, detail: row.detail }))
  }

  pruneAudit(days = REMOTE_AUDIT_RETENTION_DAYS): number {
    try { return this.db.prepare('DELETE FROM remote_audit WHERE ts < ?').run(this.now() - days * 86_400_000).changes } catch { return 0 }
  }
}
