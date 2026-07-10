/**
 * Print SHA-256 checksums for release artifacts under dist/.
 * Usage: node scripts/release-checksums.mjs
 * Use --output to attach a standard SHA256SUMS.txt file to the GitHub Release.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const outputIndex = process.argv.indexOf('--output')
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : null
const dirIndex = process.argv.indexOf('--dir')
const directory = dirIndex >= 0 ? process.argv[dirIndex + 1] : join(ROOT, 'dist')

if ((outputIndex >= 0 && !output) || (dirIndex >= 0 && !directory)) {
  console.error('Usage: node scripts/release-checksums.mjs [--dir <path>] [--output <path>]')
  process.exit(1)
}

const DIST = join(directory)

if (!existsSync(DIST)) {
  console.error('dist/ not found — run npm run dist first')
  process.exit(1)
}

const patterns = [/\.exe$/i, /\.blockmap$/i, /^(?:latest|alpha|beta|nightly|rc)\.yml$/i, /^sbom\.spdx\.json$/i]
const files = readdirSync(DIST)
  .filter((name) => patterns.some((re) => re.test(name)))
  .sort()

if (files.length === 0) {
  console.error('No release artifacts found in dist/')
  process.exit(1)
}

const checksumLines = []
console.log('## Checksums (SHA-256)\n')
for (const name of files) {
  const full = join(DIST, name)
  const buf = readFileSync(full)
  const hash = createHash('sha256').update(buf).digest('hex')
  const sizeMb = (statSync(full).size / (1024 * 1024)).toFixed(1)
  checksumLines.push(`${hash} *${name}`)
  console.log(`- \`${name}\` (${sizeMb} MB)`)
  console.log(`  \`${hash}\`\n`)
}

if (output) {
  writeFileSync(output, checksumLines.join('\n') + '\n')
  console.log(`Wrote ${output}`)
}
