/**
 * Print SHA-256 checksums for release artifacts under dist/.
 * Usage: node scripts/release-checksums.mjs
 * Paste the output into GitHub Release notes for integrity checks.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DIST = join(ROOT, 'dist')

if (!existsSync(DIST)) {
  console.error('dist/ not found — run npm run dist first')
  process.exit(1)
}

const patterns = [/\.exe$/i, /\.blockmap$/i, /^latest\.yml$/i]
const files = readdirSync(DIST)
  .filter((name) => patterns.some((re) => re.test(name)))
  .sort()

if (files.length === 0) {
  console.error('No release artifacts found in dist/')
  process.exit(1)
}

console.log('## Checksums (SHA-256)\n')
for (const name of files) {
  const full = join(DIST, name)
  const buf = readFileSync(full)
  const hash = createHash('sha256').update(buf).digest('hex')
  const sizeMb = (statSync(full).size / (1024 * 1024)).toFixed(1)
  console.log(`- \`${name}\` (${sizeMb} MB)`)
  console.log(`  \`${hash}\`\n`)
}
