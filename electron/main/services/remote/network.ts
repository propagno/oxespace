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

export interface ListenAddress {
  /** As shown to the person and put in the QR, without a zone. */
  address: string
  /** What `listen` needs: a link-local IPv6 address carries its zone (`fe80::1%12`). */
  host: string
  family: 'IPv4' | 'IPv6'
}

/** Most useful first: a LAN IPv4 address is what a phone reaches; link-local ones come last. */
const rank = (entry: ListenAddress): number => {
  const linkLocal = entry.address.startsWith('169.254.') || /^fe[89ab]/i.test(entry.address)
  return (entry.family === 'IPv4' ? 0 : 2) + (linkLocal ? 1 : 0)
}

export function listenAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>, allowed: (address: string) => boolean = isPrivateAddress): ListenAddress[] {
  const found = new Map<string, ListenAddress>()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (!allowed(entry.address) || found.has(entry.address)) continue
      const family = entry.family === 'IPv6' ? 'IPv6' : 'IPv4'
      const zoned = family === 'IPv6' && /^fe[89ab]/i.test(entry.address) && 'scopeid' in entry && entry.scopeid
      found.set(entry.address, { address: entry.address, host: zoned ? `${entry.address}%${entry.scopeid}` : entry.address, family })
    }
  }
  return [...found.values()].sort((a, b) => rank(a) - rank(b))
}

/** IPv4-mapped peers (`::ffff:192.168.0.5`) are recorded as plain IPv4. */
export function peerAddress(address: string | undefined): string {
  if (!address) return 'unknown'
  return address.startsWith('::ffff:') && isIP(address.slice(7)) === 4 ? address.slice(7) : address
}
