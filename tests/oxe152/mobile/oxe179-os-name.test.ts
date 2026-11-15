// @vitest-environment node
/**
 * Frozen acceptance test for 1.5.2 Celular A16 (Jira OXE-179; coordination's T16 conditions of 15/11 and MARCA's copy
 * answers): the name the desktop gives the phone for its OS. Written by the planner; the executor must not edit it.
 *
 * Contract: electron/main/services/remote/os-name.ts exports
 * - `osDisplayName(input: { platform: NodeJS.Platform; release: string; osRelease?: string | null }): string`, pure:
 *   win32: os.release() is "10.0.<build>", build >= 22000 is "Windows 11", otherwise "Windows 10"; darwin: the Darwin
 *   major version minus 9 ("24.x" is "macOS 15"); linux: PRETTY_NAME of /etc/os-release (`osRelease`, its text), quotes
 *   and spaces trimmed ("Ubuntu 24.04", "Fedora Linux 41"), and "Linux" when the file or the key is missing; at most 64
 *   characters; never a "·" (it is the phone's separator in the computer's line, so no "Linux · <distro>"). A product
 *   name: no translation, the same text in pt-BR and en.
 * - `desktopOsName(): string`, the same from the real node:os and /etc/os-release, which the gateway puts in
 *   RemoteAuthResult.desktopOs. Privacy: only the OS family and version, never os.hostname() or the user.
 * The module is loaded by path at run time, so this file runs (and fails by assertion) before it exists.
 *
 * Red at F4 @ origin/main 4fabc30f5: there is no os-name.ts.
 */
import { hostname, userInfo } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

interface OsName {
  osDisplayName(input: { platform: NodeJS.Platform; release: string; osRelease?: string | null }): string
  desktopOsName(): string
}

async function osName(): Promise<OsName> {
  const file = path.resolve('electron/main/services/remote/os-name.ts')
  let mod: Partial<OsName> | null = null
  try { mod = await import(/* @vite-ignore */ file) as Partial<OsName> } catch (error) { mod = null; void error }
  expect(mod, 'electron/main/services/remote/os-name.ts exists').not.toBeNull()
  expect(typeof mod!.osDisplayName, 'it exports osDisplayName').toBe('function')
  expect(typeof mod!.desktopOsName, 'it exports desktopOsName').toBe('function')
  return mod as OsName
}

describe('OXE-179 the OS name the desktop sends', () => {
  test('OXE-179 os: Windows 11 from build 22000 on, Windows 10 before', async () => {
    const { osDisplayName } = await osName()
    expect(osDisplayName({ platform: 'win32', release: '10.0.22631' })).toBe('Windows 11')
    expect(osDisplayName({ platform: 'win32', release: '10.0.22000' })).toBe('Windows 11')
    expect(osDisplayName({ platform: 'win32', release: '10.0.19045' })).toBe('Windows 10')
  })

  test('OXE-179 os: macOS from the Darwin version', async () => {
    const { osDisplayName } = await osName()
    expect(osDisplayName({ platform: 'darwin', release: '24.1.0' })).toBe('macOS 15')
    expect(osDisplayName({ platform: 'darwin', release: '23.6.0' })).toBe('macOS 14')
  })

  test('OXE-179 os: Linux is the PRETTY_NAME of os-release, and Linux without it', async () => {
    const { osDisplayName } = await osName()
    expect(osDisplayName({ platform: 'linux', release: '6.8.0', osRelease: 'NAME="Ubuntu"\nVERSION_ID="24.04"\nPRETTY_NAME="Ubuntu 24.04"\nID=ubuntu\n' })).toBe('Ubuntu 24.04')
    expect(osDisplayName({ platform: 'linux', release: '6.11.4', osRelease: "NAME='Fedora Linux'\nPRETTY_NAME='  Fedora Linux 41  '\n" })).toBe('Fedora Linux 41')
    expect(osDisplayName({ platform: 'linux', release: '6.8.0', osRelease: 'PRETTY_NAME=Arch Linux\n' })).toBe('Arch Linux')
    expect(osDisplayName({ platform: 'linux', release: '6.8.0', osRelease: null }), 'no os-release').toBe('Linux')
    expect(osDisplayName({ platform: 'linux', release: '6.8.0', osRelease: 'NAME="Something"\n' }), 'no PRETTY_NAME').toBe('Linux')
    const long = osDisplayName({ platform: 'linux', release: '6.8.0', osRelease: `PRETTY_NAME="${'A very long distribution name '.repeat(5)}"\n` })
    expect(long.length).toBeLessThanOrEqual(64)
    for (const name of [long, osDisplayName({ platform: 'linux', release: '6.8.0', osRelease: 'PRETTY_NAME="Ubuntu 24.04"\n' })]) expect(name).not.toContain('·')
  })

  test('OXE-179 os: only the OS family and version, never the machine or the user', async () => {
    const { desktopOsName } = await osName()
    const name = desktopOsName()
    expect(typeof name).toBe('string')
    expect(name.trim().length).toBeGreaterThan(0)
    expect(name.length).toBeLessThanOrEqual(64)
    expect(name).not.toContain('·')
    const machine = hostname(), user = userInfo().username
    if (machine.length > 2) expect(name.toLowerCase()).not.toContain(machine.toLowerCase())
    if (user.length > 2) expect(name.toLowerCase()).not.toContain(user.toLowerCase())
  })
})
