// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { LATEST_DB_VERSION, openInMemoryDatabase } from '../../electron/main/db'
import { auditJsonl } from '../../electron/main/services/audit-export'
import { RemoteStore, TooManyDevicesError } from '../../electron/main/services/remote/store'

describe('remote store (migration 086)', () => {
  test('devices: add up to five, rename, revoke keeps the row, touch', () => {
    const db = openInMemoryDatabase()
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_DB_VERSION)
    const columns = (db.prepare("PRAGMA table_info('remote_devices')").all() as Array<{ name: string }>).map(column => column.name)
    expect(columns).toEqual(['device_id', 'name', 'public_key_spki', 'paired_at', 'last_seen_at', 'revoked', 'revoked_at'])
    let now = 1000
    const store = new RemoteStore(db, () => now)
    const devices = Array.from({ length: 5 }, (_, index) => store.addDevice(`Phone ${index}`, Buffer.from([index])))
    expect(() => store.addDevice('Sixth', Buffer.from([9]))).toThrow(TooManyDevicesError)
    expect(store.rename(devices[0].deviceId, 'Renamed')?.name).toBe('Renamed')
    expect(store.revoke(devices[0].deviceId)).toBe(true)
    expect(store.revoke(devices[0].deviceId)).toBe(false)
    expect(store.rename(devices[0].deviceId, 'Again')).toBeUndefined()
    expect(store.device(devices[0].deviceId)?.revoked).toBe(true)
    expect(store.activeCount()).toBe(4)
    now = 5000
    store.touch(devices[1].deviceId)
    expect(store.device(devices[1].deviceId)?.lastSeenAt).toBe(5000)
    expect(store.addDevice('Fifth again', Buffer.from([7])).name).toBe('Fifth again')
    expect(store.revokeAll()).toBe(5)
  })

  test('settings default to port 47321 and nothing stored; the audit is append-only and exported', () => {
    const db = openInMemoryDatabase()
    const store = new RemoteStore(db, () => 42)
    expect(store.settings()).toEqual({ port: 47_321, certificateDer: null, certificateKey: null, desktopName: null })
    store.savePort(50_000)
    store.saveCertificate({ der: Buffer.from([1]), encryptedKey: Buffer.from([2]) })
    store.saveDesktopName('Desk')
    expect(store.settings()).toMatchObject({ port: 50_000, certificateDer: Buffer.from([1]), desktopName: 'Desk' })
    store.audit({ action: 'revoke', outcome: 'ok', deviceId: 'd1', remoteAddress: '10.0.0.2', detail: 'x' })
    expect(() => db.prepare("UPDATE remote_audit SET outcome = 'changed'").run()).toThrow('append-only')
    expect(auditJsonl(db)).toContain('"source":"remote"')
    expect(store.pruneAudit(0)).toBe(0) // written at "now": nothing is older than now
  })
})
