import { isIP } from 'node:net'
import type { NetworkInterfaceInfo } from 'node:os'

/**
 * Where the gateway may listen: private addresses only. RFC 1918 (10/8, 172.16/12, 192.168/16), IPv4 link-local
 * (169.254/16), IPv6 unique local (fc00::/7) and link-local (fe80::/10). Never loopback, never a public address and
 * never the wildcard (`0.0.0.0`, `::`), so nothing outside the LAN can reach it.
 */
export function isPrivateAddress(address: string): boolean {
  if (typeof address !== 'string') return false
  const bare = address.split('%')[0]
  const kind = isIP(bare)
  if (kind === 4) {
    const [a, b] = bare.split('.').map(Number)
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  }
  if (kind === 6) {
    const first = bare.toLowerCase().split(':')[0]
    if (!first) return false // `::`, `::1`, `::ffff:…`: unspecified, loopback or mapped, never private here.
    const value = Number.parseInt(first, 16)
    return (value & 0xfe00) === 0xfc00 || (value & 0xffc0) === 0xfe80
  }
  return false
}

/** RFC 6598 shared address space, 100.64.0.0/10: carrier-grade NAT, and also what Tailscale hands out. */
export function isCgnatAddress(address: string): boolean {
  if (typeof address !== 'string') return false
  const bare = peerAddress(address.split('%')[0])
  if (isIP(bare) !== 4) return false
  const [a, b] = bare.split('.').map(Number)
  return a === 100 && b >= 64 && b <= 127
}

/**
 * OXE-383: the adapters a phone may reach this computer through over a VPN (Tailscale, WireGuard, macOS utun, ZeroTier).
 * Only with the person's opt-in (off by default) does the gateway also listen on such an adapter's 100.64/10 address; the
 * same range on any other adapter is carrier-grade NAT and is never listened on. An adapter's name is set on this
 * computer (by the person or the VPN they installed), not by anyone on the network, so it is a local fact and not a
 * remote trust input: it only picks which of this computer's own addresses may carry the gateway.
 */
export const VPN_ADAPTER = /^(?:tailscale|wg|wireguard|utun|zerotier|zt)/i

/**
 * Whether a connection may go on: a 100.64/10 peer only while the VPN opt-in is on and only on a VPN listener (a
 * 100.64/10 local address, which [listenAddresses] binds only on a VPN adapter). Every other peer is as before.
 */
export function vpnPeerAllowed(peer: string | undefined, local: string | undefined, allowVpn: boolean): boolean {
  if (!isCgnatAddress(peerAddress(peer))) return true
  return allowVpn && isCgnatAddress(peerAddress(local))
}

export interface ListenAddress {
  /** As shown to the person and put in the QR, without a zone. */
  address: string
  /** What `listen` needs: a link-local IPv6 address carries its zone (`fe80::1%12`). */
  host: string
  family: 'IPv4' | 'IPv6'
}

/** Adapters a phone never reaches: Hyper-V/WSL switches, VM host-only networks, containers. */
const VIRTUAL = /^(?:vEthernet|WSL|Hyper-V|VirtualBox|VMware|vmnet|docker|br-|veth|virbr|Npcap|Bluetooth)/i

/** Most useful first: a LAN IPv4 address is what a phone reaches; virtual adapters, then link-local ones, come last. */
const rank = (entry: ListenAddress & { virtual?: boolean }): number => {
  const linkLocal = entry.address.startsWith('169.254.') || /^fe[89ab]/i.test(entry.address)
  // OXE-383: a VPN address comes after every LAN one, so the QR keeps naming the LAN first.
  return (isCgnatAddress(entry.address) ? 8 : 0) + (entry.virtual ? 4 : 0) + (entry.family === 'IPv4' ? 0 : 2) + (linkLocal ? 1 : 0)
}

/** `allowVpn` (OXE-383, off by default): also a VPN adapter's 100.64/10 address, never that range on another adapter. */
export function listenAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>, allowed: (address: string) => boolean = isPrivateAddress, options: { allowVpn?: boolean } = {}): ListenAddress[] {
  const found = new Map<string, ListenAddress & { virtual?: boolean }>()
  for (const [name, entries] of Object.entries(interfaces)) {
    const virtual = VIRTUAL.test(name)
    const vpn = options.allowVpn === true && VPN_ADAPTER.test(name)
    for (const entry of entries ?? []) {
      const cgnat = isCgnatAddress(entry.address)
      if (cgnat ? !vpn : !allowed(entry.address)) continue
      if (found.has(entry.address)) continue
      const family = entry.family === 'IPv6' ? 'IPv6' : 'IPv4'
      const zoned = family === 'IPv6' && /^fe[89ab]/i.test(entry.address) && 'scopeid' in entry && entry.scopeid
      found.set(entry.address, { address: entry.address, host: zoned ? `${entry.address}%${entry.scopeid}` : entry.address, family, ...(virtual ? { virtual } : {}) })
    }
  }
  return [...found.values()].sort((a, b) => rank(a) - rank(b)).map(({ virtual: _virtual, ...entry }) => entry)
}

/** IPv4-mapped peers (`::ffff:192.168.0.5`) are recorded as plain IPv4. */
/** `addresses` with the one the default route leaves from first (the QR names the first). */
export function preferRoute(addresses: readonly ListenAddress[], route: string | null): ListenAddress[] {
  const index = route ? addresses.findIndex(entry => entry.address === route) : -1
  return index > 0 ? [addresses[index], ...addresses.slice(0, index), ...addresses.slice(index + 1)] : [...addresses]
}

export function peerAddress(address: string | undefined): string {
  if (!address) return 'unknown'
  return address.startsWith('::ffff:') && isIP(address.slice(7)) === 4 ? address.slice(7) : address
}
