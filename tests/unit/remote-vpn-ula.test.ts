// OXE-409 (decision P-1 = A, 23/11): with the "also reach this computer over a VPN" setting off (the default), the
// desktop listens on no address of a VPN adapter (Tailscale, WireGuard, utun, ZeroTier): not its 100.64/10 address
// (OXE-383), and now not its IPv6 unique local (fc00::/7) or link-local (fe80::/10) address, nor a private IPv4 on it.
// The cut is by the adapter's name (VPN_ADAPTER), so a home LAN's own ULA and link-local addresses do not change.
// With the setting on, a VPN adapter's addresses are listened on, after every LAN one.
// P-2: no machine with Tailscale or WireGuard was available (23/11), so the per-platform interfaces are simulated from
// the documented adapter shapes (tests/fixtures/remote/vpn-interfaces/); a real capture stays a gap on the card.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { VPN_ADAPTER, listenAddresses, preferRoute, vpnPeerAllowed } from '../../electron/main/services/remote/network'

type Entry = { address: string; family: 'IPv4' | 'IPv6'; internal: boolean; netmask: string; mac: string; cidr: string | null; scopeid?: number }
const entry = (address: string, family: 'IPv4' | 'IPv6' = 'IPv4', scopeid?: number): Entry => ({ address, family, internal: false, netmask: '', mac: '', cidr: null, ...(scopeid !== undefined ? { scopeid } : {}) })
const interfaces = {
  'Wi-Fi': [entry('192.168.0.10'), entry('fd12:3456::10', 'IPv6', 0)],
  Tailscale: [entry('100.101.102.103'), entry('fd7a:115c:a1e0::1', 'IPv6', 0), entry('fe80::5', 'IPv6', 23)],
  wg0: [entry('fd00:77::1', 'IPv6', 0), entry('10.77.0.2')],
}
const listen = (ifaces: Record<string, Entry[]>, allowVpn: boolean) => listenAddresses(ifaces as never, undefined, { allowVpn })

describe('OXE-409 · a VPN adapter is listened on only with the opt-in', () => {
  test('OXE-409: with the VPN opt-in off, no address of a VPN adapter is listened on, its IPv6 ULA and link-local included', () => {
    const off = listen(interfaces, false).map(found => found.address)
    expect(off).toEqual(['192.168.0.10', 'fd12:3456::10'])
    for (const address of ['fd7a:115c:a1e0::1', 'fd00:77::1', 'fe80::5', '10.77.0.2', '100.101.102.103']) expect(off, address).not.toContain(address)
    // The default (no options) is off.
    expect(listenAddresses(interfaces as never).map(found => found.address)).toEqual(off)
  })

  test('OXE-409: a home LAN keeps its own ULA and link-local addresses, with the opt-in on or off', () => {
    const home = { 'Wi-Fi': [entry('192.168.0.10'), entry('fd12:3456::10', 'IPv6', 0), entry('fe80::1c2d', 'IPv6', 11)], Ethernet: [entry('fdab::7', 'IPv6', 0)] }
    for (const allowVpn of [false, true]) {
      expect(listen(home, allowVpn), `allowVpn ${allowVpn}`).toEqual([
        { address: '192.168.0.10', host: '192.168.0.10', family: 'IPv4' },
        { address: 'fd12:3456::10', host: 'fd12:3456::10', family: 'IPv6' },
        { address: 'fdab::7', host: 'fdab::7', family: 'IPv6' },
        { address: 'fe80::1c2d', host: 'fe80::1c2d%11', family: 'IPv6' },
      ])
    }
  })

  test('OXE-409: with the opt-in on, the VPN adapters are listened on after the LAN, link-local with its zone', () => {
    expect(listen(interfaces, true)).toEqual([
      { address: '192.168.0.10', host: '192.168.0.10', family: 'IPv4' },
      { address: '10.77.0.2', host: '10.77.0.2', family: 'IPv4' },
      { address: 'fd12:3456::10', host: 'fd12:3456::10', family: 'IPv6' },
      { address: 'fd7a:115c:a1e0::1', host: 'fd7a:115c:a1e0::1', family: 'IPv6' },
      { address: 'fd00:77::1', host: 'fd00:77::1', family: 'IPv6' },
      { address: 'fe80::5', host: 'fe80::5%23', family: 'IPv6' },
      { address: '100.101.102.103', host: '100.101.102.103', family: 'IPv4' },
    ])
  })

  test('OXE-409: the QR never names a VPN adapter address with the opt-in off', () => {
    // The QR takes the first address of preferRoute(listenAddresses(...)).
    expect(preferRoute(listen(interfaces, false), '192.168.0.10')[0]?.address).toBe('192.168.0.10')
    // Only a VPN adapter, no LAN: nothing to listen on, so nothing for the QR, instead of the tailnet's ULA.
    const vpnOnly = { Tailscale: interfaces.Tailscale }
    expect(listen(vpnOnly, false)).toEqual([])
    expect(preferRoute(listen(vpnOnly, false), null)).toEqual([])
    // With the opt-in on it names the VPN adapter's ULA first (before its link-local and its 100.64/10 address).
    expect(preferRoute(listen(vpnOnly, true), null)[0]?.address).toBe('fd7a:115c:a1e0::1')
    // A tailnet ULA peer still passes vpnPeerAllowed (only 100.64/10 peers are checked), but with the opt-in off the
    // gateway has no listener on the tailnet for it to reach.
    expect(vpnPeerAllowed('fd7a:115c:a1e0::9', 'fd7a:115c:a1e0::1', false)).toBe(true)
    expect(listen(interfaces, false).map(found => found.address)).not.toContain('fd7a:115c:a1e0::1')
  })

  test('OXE-409: simulated VPN adapters (win32, darwin, linux) are named by VPN_ADAPTER and not listened on with the opt-in off', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
      const fixture = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'remote', 'vpn-interfaces', `${platform}.json`), 'utf8')) as {
        _source: string; platform: string; vpnAdapters: string[]; interfaces: Record<string, Entry[]>; lan: string[]
      }
      expect(fixture.platform).toBe(platform)
      expect(fixture._source, `${platform}: the fixture says it is simulated, not a capture`).toMatch(/^Simulated \(OXE-409\)/)
      for (const name of Object.keys(fixture.interfaces)) expect(VPN_ADAPTER.test(name), `${platform} ${name}`).toBe(fixture.vpnAdapters.includes(name))
      const vpnAddresses = fixture.vpnAdapters.flatMap(name => fixture.interfaces[name].map(found => found.address))
      const off = listen(fixture.interfaces, false).map(found => found.address)
      expect([...off].sort(), `${platform}: only the LAN with the opt-in off`).toEqual([...fixture.lan].sort())
      for (const address of vpnAddresses) expect(off, `${platform} ${address}`).not.toContain(address)
      // On: the LAN still comes first, then the VPN adapters' addresses that a phone can reach.
      const on = listen(fixture.interfaces, true).map(found => found.address)
      expect(on.slice(0, 1), `${platform}: the LAN IPv4 first`).toEqual(['192.168.0.10'])
      expect(on, `${platform}: the tailnet ULA with the opt-in on`).toContain('fd7a:115c:a1e0::1')
    }
  })
})
