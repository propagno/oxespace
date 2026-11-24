// OXE-383 (part B1b-1): the desktop's "Also reach this computer over a VPN (Tailscale, WireGuard)" setting, stored in
// main, off by default. Only a stored '1' is on. The gateway reports it in its status, changes it only for exactly
// `{ allowed: boolean }`, audits the change, and while it listens applies it by listening again: every open
// connection closes, so no VPN peer stays connected once it is turned off. The window's channel comes in part B1b-2.
import net from 'node:net'
import { afterEach, describe, expect, test } from 'vitest'
import { parseAllowVpnInput, remoteVpnAllowed, setRemoteVpnAllowed } from '../../electron/main/services/remote/vpn-setting'
import { Harness } from '../helpers/remote-gateway-harness'

const harnesses: Harness[] = []
const harness = (...args: ConstructorParameters<typeof Harness>) => { const value = new Harness(...args); harnesses.push(value); return value }
afterEach(async () => { await Promise.all(harnesses.splice(0).map(value => value.close())) })

const audits = (h: Harness, action: string) =>
  h.db.prepare('SELECT outcome FROM remote_audit WHERE action = ? ORDER BY id').all(action) as Array<{ outcome: string }>

describe('OXE-383 B1b-1 · the VPN setting on the desktop', () => {
  test('off by default, only a stored 1 is on, and the input is exactly { allowed: boolean }', () => {
    const h = harness()
    expect(remoteVpnAllowed(h.db)).toBe(false)
    expect(h.gateway.status().allowVpn).toBe(false)
    for (const stored of ['0', 'true', 'yes', '', ' 1']) {
      h.db.prepare("INSERT INTO thread_settings (key, value, updated_at) VALUES ('remote_allow_vpn', ?, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(stored)
      expect(remoteVpnAllowed(h.db), `stored ${JSON.stringify(stored)}`).toBe(false)
    }
    setRemoteVpnAllowed(h.db, true)
    expect(remoteVpnAllowed(h.db)).toBe(true)
    expect(parseAllowVpnInput({ allowed: false })).toBe(false)
    for (const bad of [null, true, 'on', [], {}, { allowed: 'yes' }, { allowed: 1 }, { allowed: true, port: 1 }]) {
      expect(() => parseAllowVpnInput(bad), JSON.stringify(bad)).toThrow('Invalid VPN setting')
    }
  })

  test('a change is stored, audited and broadcast; a repeat changes nothing', async () => {
    const h = harness({ allowVpnAddresses: () => remoteVpnAllowed(h.db) })
    await expect(h.gateway.setAllowVpn({ allowed: 'yes' })).rejects.toThrow('Invalid VPN setting')
    expect(remoteVpnAllowed(h.db)).toBe(false)
    const on = await h.gateway.setAllowVpn({ allowed: true })
    expect(on.allowVpn).toBe(true)
    expect(remoteVpnAllowed(h.db)).toBe(true)
    expect(h.changes.at(-1)?.status?.allowVpn).toBe(true)
    await h.gateway.setAllowVpn({ allowed: true })
    expect(audits(h, 'vpn')).toEqual([{ outcome: 'on' }])
    const off = await h.gateway.setAllowVpn({ allowed: false })
    expect(off.allowVpn).toBe(false)
    expect(audits(h, 'vpn')).toEqual([{ outcome: 'on' }, { outcome: 'off' }])
  })

  test('while listening, a change listens again on the same port and closes every open connection', async () => {
    const h = harness({ allowVpnAddresses: () => remoteVpnAllowed(h.db) })
    const target = await h.enable()
    const socket = net.connect({ host: target.host, port: target.port })
    await new Promise<void>((resolve, reject) => { socket.once('connect', () => resolve()); socket.once('error', reject) })
    const closed = new Promise<void>(resolve => socket.once('close', () => resolve()))
    const status = await h.gateway.setAllowVpn({ allowed: true })
    await closed
    expect(status.enabled).toBe(true)
    expect(status.listening?.port).toBe(target.port)
    expect(status.allowVpn).toBe(true)
    // Turned off again, still listening on the same port.
    const back = await h.gateway.setAllowVpn({ allowed: false })
    expect(back.enabled).toBe(true)
    expect(back.listening?.port).toBe(target.port)
  })
})
