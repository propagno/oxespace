import { execFile } from 'node:child_process'
import { createSocket } from 'node:dgram'
import type { NetworkInterfaceInfo } from 'node:os'
import type { RemoteNetworkCategory } from '../../../../shared/types/remote'

/**
 * Two cheap reads that explain a pairing that never reaches this computer (1.4.1, the user's phone):
 * - Windows' network profile of the interface the QR names. On a **Public** network Windows drops unsolicited inbound
 *   connections unless a rule allows the app, so the phone's request never arrives. Read only: no elevation, and
 *   OXESpace never changes the profile or the firewall itself.
 * - The address the default route leaves from, so the QR names the LAN adapter and not a vEthernet/WSL/Hyper-V one
 *   that happens to come first. A UDP socket is "connected" to a documentation address (TEST-NET-1): the system picks
 *   the source address from its routing table, and no packet is sent.
 */

const PROFILE_TIMEOUT_MS = 4_000
/** `Get-NetConnectionProfile` as `alias<TAB>category` lines; the enum prints as its name. */
const PROFILE_SCRIPT = 'Get-NetConnectionProfile | ForEach-Object { [string]$_.InterfaceAlias + [char]9 + [string]$_.NetworkCategory }'

export type ProfileRunner = () => Promise<string>

const runPowerShell: ProfileRunner = () => new Promise((resolve, reject) => {
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PROFILE_SCRIPT], { timeout: PROFILE_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 }, (error, stdout) => {
    if (error) reject(error)
    else resolve(String(stdout))
  })
})

/** Interface alias (lower case) → category. Unknown names and categories are left out. */
export function parseConnectionProfiles(output: string): Map<string, RemoteNetworkCategory> {
  const found = new Map<string, RemoteNetworkCategory>()
  for (const line of output.split(/\r?\n/)) {
    const [alias, raw] = line.split('\t')
    if (!alias?.trim() || !raw) continue
    const word = raw.trim().toLowerCase()
    const category: RemoteNetworkCategory | null = word === 'public' || word === '0' ? 'public'
      : word === 'private' || word === '1' ? 'private'
      : word === 'domainauthenticated' || word === '2' ? 'domain' : null
    if (category) found.set(alias.trim().toLowerCase(), category)
  }
  return found
}

/** The categories Windows gives each connected interface; empty elsewhere or when the read fails. */
export async function networkCategories(platform: string = process.platform, run: ProfileRunner = runPowerShell): Promise<Map<string, RemoteNetworkCategory>> {
  if (platform !== 'win32') return new Map()
  try { return parseConnectionProfiles(await run()) } catch { return new Map() }
}

/** The local IPv4 address the default route uses, or null without one. Sends nothing. */
export function defaultRouteAddress(): Promise<string | null> {
  return new Promise(resolve => {
    const socket = createSocket('udp4')
    const done = (value: string | null) => { try { socket.close() } catch { /* already closed */ } resolve(value) }
    socket.once('error', () => done(null))
    try {
      socket.connect(9, '192.0.2.1', () => {
        try { done(socket.address().address || null) } catch { done(null) }
      })
    } catch { done(null) }
  })
}

/** The interface (as `os.networkInterfaces()` names it) that holds `address`. */
export function interfaceOf(address: string, interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string | null {
  for (const [name, entries] of Object.entries(interfaces)) if (entries?.some(entry => entry.address === address)) return name
  return null
}
