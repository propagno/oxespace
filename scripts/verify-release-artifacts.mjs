#!/usr/bin/env node
/**
 * Validate the exact release payload for one OS before it becomes public.
 * Checks the expected version/tag, updater manifest SHA-512, and (when
 * present) the SHA-256 checksum file uploaded alongside the release.
 *
 * Usage: node scripts/verify-release-artifacts.mjs --dir <path> --version <v>
 *          --tag <vX.Y.Z> [--platform win|linux]   (--platform defaults to host)
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]
  const value = process.argv[index + 1]
  if (!key?.startsWith('--') || !value) {
    console.error('Usage: node scripts/verify-release-artifacts.mjs --dir <path> --version <version> --tag <tag> [--platform win|linux]')
    process.exit(1)
  }
  args.set(key.slice(2), value)
}

const directory = resolve(args.get('dir') ?? 'dist')
const version = args.get('version')
const tag = args.get('tag')
if (!version || !tag) {
  console.error('Both --version and --tag are required.')
  process.exit(1)
}
if (tag !== `v${version}`) {
  console.error(`Tag ${tag} does not match package version ${version}. Expected v${version}.`)
  process.exit(1)
}
if (!existsSync(directory)) {
  console.error(`Release directory not found: ${directory}`)
  process.exit(1)
}

// Which OS payload this run is verifying. Defaults to the host so the existing
// Windows invocation keeps working without the flag.
const platform = args.get('platform') ?? (process.platform === 'win32' ? 'win' : 'linux')
if (platform !== 'win' && platform !== 'linux') {
  console.error(`Unsupported --platform ${platform}. Expected "win" or "linux".`)
  process.exit(1)
}

const prerelease = version.match(/-([a-z]+)(?:[.-]|$)/i)?.[1]?.toLowerCase()
const channel = prerelease ?? 'latest'
// electron-updater writes a per-OS manifest on Linux (latest-linux.yml) but an
// unsuffixed one on Windows.
const manifestName = platform === 'linux' ? `${channel}-linux.yml` : `${channel}.yml`

// The manifest's `path` points at the primary in-place-updatable artifact:
// the NSIS installer on Windows, the AppImage on Linux (a .deb cannot self-update).
const installerName = platform === 'linux'
  ? `OXESpace-${version}-x64.AppImage`
  : `OXESpace-${version}-x64.exe`

const present = new Set(readdirSync(directory))

// The build job emits a bare sbom.spdx.json; the release job namespaces it per
// platform before publishing so the two legs cannot overwrite each other.
// Accept whichever form is on disk so the same check covers both stages.
const sbomName = [`sbom-${platform === 'win' ? 'windows' : 'linux'}-x64.spdx.json`, 'sbom.spdx.json']
  .find((name) => present.has(name)) ?? 'sbom.spdx.json'

const required = [installerName, manifestName, sbomName]
// Blockmaps are a Windows/NSIS differential-download artifact; Linux has none.
if (platform === 'win') required.push(`${installerName}.blockmap`)

// The .deb is matched by pattern, not by exact name: electron-builder renders
// ${arch} as the Debian architecture (amd64) rather than the Electron one (x64),
// and that naming is upstream's to change. Without this the .deb shipped
// unverified — absent or corrupt, it passed every check.
if (platform === 'linux') {
  const debs = [...present].filter((name) => /\.deb$/i.test(name))
  if (debs.length !== 1) {
    console.error(
      debs.length === 0
        ? 'Missing release artifact: no .deb produced by the Linux build.'
        : `Expected exactly one .deb, found ${debs.length}: ${debs.join(', ')}`
    )
    process.exit(1)
  }
  required.push(debs[0])
}

const missing = required.filter((name) => !present.has(name))
if (missing.length > 0) {
  console.error(`Missing release artifact(s): ${missing.join(', ')}`)
  process.exit(1)
}

const manifest = readFileSync(resolve(directory, manifestName), 'utf8')
const yamlValue = (key) => {
  const match = manifest.match(new RegExp(`^${key}:\\s*["']?([^\\r\\n"']+)["']?\\s*$`, 'm'))
  return match?.[1]?.trim() ?? null
}
const manifestVersion = yamlValue('version')
const manifestPath = yamlValue('path')
const manifestSha512 = yamlValue('sha512')
if (manifestVersion !== version || manifestPath !== installerName || !manifestSha512) {
  console.error(`Invalid ${manifestName}: expected version=${version}, path=${installerName}, and sha512.`)
  process.exit(1)
}

const installer = readFileSync(resolve(directory, installerName))
const actualSha512 = createHash('sha512').update(installer).digest('base64')
if (actualSha512 !== manifestSha512) {
  console.error(`${manifestName} SHA-512 does not match ${installerName}.`)
  process.exit(1)
}

const checksumsPath = resolve(directory, 'SHA256SUMS.txt')
if (existsSync(checksumsPath)) {
  const checksums = new Map(
    readFileSync(checksumsPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const match = line.match(/^([a-f0-9]{64}) \*(.+)$/i)
      if (!match) throw new Error(`Malformed checksum line: ${line}`)
      return [match[2], match[1].toLowerCase()]
    })
  )
  for (const name of required) {
    const expected = checksums.get(name)
    const actual = createHash('sha256').update(readFileSync(resolve(directory, name))).digest('hex')
    if (actual !== expected) {
      console.error(`SHA-256 checksum mismatch for ${name}.`)
      process.exit(1)
    }
  }
}

console.log(`Verified ${tag} (${platform}): ${required.join(', ')}, and checksums.`)
