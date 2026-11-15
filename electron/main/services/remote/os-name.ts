import { readFileSync } from 'node:fs'
import { release } from 'node:os'

/**
 * OXE-179: the name of the OS this desktop runs on, as the phone shows it in the paired computer's line ("Windows 11",
 * "macOS 15", os-release's PRETTY_NAME such as "Ubuntu 24.04", or "Linux"). A product name: never translated. Only
 * the OS family and version: never the host name, the user or a path. At most 64 characters and never a "·", which is
 * the phone's separator in that line. Sent only after sign-in (RemoteAuthResult.desktopOs), never in `hello`.
 */
export const OS_NAME_MAX_LENGTH = 64

export interface OsNameInput {
  platform: NodeJS.Platform
  /** os.release(): "10.0.<build>" on Windows, the Darwin version on macOS, the kernel on Linux. */
  release: string
  /** The text of /etc/os-release, or null when it could not be read. Linux only. */
  osRelease?: string | null
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g

function tidy(text: string): string {
  return text.replace(CONTROL, ' ').replaceAll('·', ' ').replace(/\s+/g, ' ').trim().slice(0, OS_NAME_MAX_LENGTH).trim()
}

function prettyName(osRelease: string | null | undefined): string | null {
  if (!osRelease) return null
  const line = /^PRETTY_NAME=(.*)$/m.exec(osRelease)?.[1]?.trim()
  if (!line) return null
  const value = tidy(line.replace(/^(["'])(.*)\1$/, '$2'))
  return value || null
}

/** Pure: the display name from what node:os and /etc/os-release say. */
export function osDisplayName(input: OsNameInput): string {
  if (input.platform === 'win32') {
    const build = Number(/^\d+\.\d+\.(\d+)/.exec(input.release)?.[1])
    return Number.isFinite(build) && build >= 22_000 ? 'Windows 11' : 'Windows 10'
  }
  if (input.platform === 'darwin') {
    const major = Number(/^(\d+)/.exec(input.release)?.[1])
    return Number.isFinite(major) && major > 9 ? `macOS ${major - 9}` : 'macOS'
  }
  if (input.platform === 'linux') return prettyName(input.osRelease) ?? 'Linux'
  // Another Unix (FreeBSD, …): its family name only.
  const family = tidy(String(input.platform))
  return family ? family.charAt(0).toUpperCase() + family.slice(1) : 'Unknown'
}

function readOsRelease(): string | null {
  // Only the system's fixed files, never a path from anyone else.
  for (const file of ['/etc/os-release', '/usr/lib/os-release']) {
    try { return readFileSync(file, 'utf8') } catch { /* the next one */ }
  }
  return null
}

let cached: string | null = null

/** The display name of this machine's OS, from the real node:os and /etc/os-release; read once. */
export function desktopOsName(): string {
  if (cached === null) {
    const platform = process.platform
    cached = osDisplayName({ platform, release: release(), osRelease: platform === 'linux' ? readOsRelease() : null })
  }
  return cached
}
