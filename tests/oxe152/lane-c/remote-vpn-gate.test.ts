// OXE-383 (part B1a): the desktop gateway and a VPN (Tailscale, WireGuard). RFC 6598 addresses (100.64.0.0/10) are
// carrier-grade NAT as often as they are a VPN, so they are trusted only when the person opted in (off by default) and
// only on an adapter this computer names as a VPN:
// - a 100.64/10 address on any other adapter is never listened on, with the setting on or off;
// - with the setting off, a 100.64/10 peer is refused even when it reaches a VPN adapter's address;
// - with it on, a 100.64/10 peer is accepted only on a VPN listener.
// Everything else (RFC 1918, link-local, IPv6 ULA) is exactly as before.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import * as network from '../../../electron/main/services/remote/network'

const entry = (address: string, family: 'IPv4' | 'IPv6' = 'IPv4') => ({ address, family, internal: false, netmask: '', mac: '', cidr: null })
const interfaces = {
  'Wi-Fi': [entry('192.168.0.10'), entry('100.70.1.2')],
  'Cellular hotspot': [entry('100.100.9.9')],
  Tailscale: [entry('100.101.102.103'), entry('fd7a:115c:a1e0::1', 'IPv6')],
  wg0: [entry('100.64.0.5')],
} as never
type Listen = (interfaces: never, allowed?: (address: string) => boolean, options?: { allowVpn?: boolean }) => Array<{ address: string }>
const listen = (allowVpn?: boolean) => (network.listenAddresses as unknown as Listen)(interfaces, undefined, allowVpn === undefined ? undefined : { allowVpn }).map(e => e.address)

describe('OXE-383 B1a · VPN addresses on the desktop', () => {
  test('a 100.64/10 address on a non-VPN adapter is never listened on, with the setting on or off', () => {
    for (const allowVpn of [undefined, false, true]) {
      const found = listen(allowVpn)
      expect(found, `allowVpn ${allowVpn}`).not.toContain('100.70.1.2')
      expect(found, `allowVpn ${allowVpn}`).not.toContain('100.100.9.9')
      expect(found[0]).toBe('192.168.0.10')
    }
    // Off (the default): no 100.64/10 address at all, the VPN adapter's ULA as before.
    expect(listen()).toEqual(['192.168.0.10', 'fd7a:115c:a1e0::1'])
    expect(listen(false)).toEqual(['192.168.0.10', 'fd7a:115c:a1e0::1'])
    // On: the VPN adapters' 100.64/10 addresses too, after the LAN, so the QR still names the LAN address first.
    expect(listen(true)).toEqual(['192.168.0.10', 'fd7a:115c:a1e0::1', '100.101.102.103', '100.64.0.5'])
  })

  test('with the setting off, a 100.64/10 peer is refused even on a VPN adapter', () => {
    const allowed = (network as unknown as { vpnPeerAllowed?: (peer: string, local: string, allowVpn: boolean) => boolean }).vpnPeerAllowed
    expect(typeof allowed).toBe('function')
    expect(allowed!('100.101.0.7', '100.101.102.103', false)).toBe(false)
    expect(allowed!('::ffff:100.101.0.7', '::ffff:100.101.102.103', false)).toBe(false)
    expect(allowed!('100.101.0.7', '192.168.0.10', false)).toBe(false)
    // On: only on a VPN listener (a 100.64/10 local address, which only a VPN adapter can carry).
    expect(allowed!('100.101.0.7', '100.101.102.103', true)).toBe(true)
    expect(allowed!('100.101.0.7', '192.168.0.10', true)).toBe(false)
    // Every other peer is unchanged.
    expect(allowed!('192.168.0.33', '192.168.0.10', false)).toBe(true)
    expect(allowed!('fd7a:115c:a1e0::9', 'fd7a:115c:a1e0::1', false)).toBe(true)
  })

  test('the adapter names are one exported, commented constant, and the gateway checks every connection', () => {
    const vpn = (network as unknown as { VPN_ADAPTER?: RegExp }).VPN_ADAPTER
    expect(vpn).toBeInstanceOf(RegExp)
    for (const name of ['Tailscale', 'tailscale0', 'wg0', 'WireGuard Tunnel', 'utun3', 'ZeroTier One', 'zt7nnig26']) expect(vpn!.test(name), name).toBe(true)
    for (const name of ['Wi-Fi', 'Ethernet', 'en0', 'Cellular hotspot', 'vEthernet (WSL)']) expect(vpn!.test(name), name).toBe(false)
    expect(network.isCgnatAddress('100.64.0.0')).toBe(true)
    expect(network.isCgnatAddress('100.127.255.255')).toBe(true)
    expect(network.isCgnatAddress('100.63.255.255')).toBe(false)
    expect(network.isCgnatAddress('100.128.0.0')).toBe(false)
    // CGNAT is not a private address by itself: isPrivateAddress is unchanged.
    expect(network.isPrivateAddress('100.101.102.103')).toBe(false)

    const gateway = readFileSync(join(process.cwd(), 'electron/main/services/remote/gateway.ts'), 'utf8')
    expect(gateway).toMatch(/server\.on\('connection'[\s\S]{0,400}vpnPeerAllowed\(/)
    expect(gateway).toMatch(/allowVpnAddresses\?:\s*\(\)\s*=>\s*boolean/)
    expect(gateway).toMatch(/this\.deps\.allowVpnAddresses\?\.\(\)\s*\?\?\s*false/)
  })
})
