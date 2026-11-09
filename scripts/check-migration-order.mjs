/**
 * The migration order guard. The runner (electron/main/db/index.ts) applies a migration when the database's
 * user_version is below its number (`if (startingVersion < N)`). So a database that reached 096 skips 094 and 095
 * for good if they land after it. 1.5.0's phases run in parallel and each reserves its own number (094, 095,
 * 096), so a PR that adds N must find every number below N already in the tree it merges into: this guard runs on
 * the tree CI tests (a PR's head, kept up to date with main by the merge train) and says which ones to merge first.
 *
 *   node scripts/check-migration-order.mjs      prints the findings; exit 1 when there is one
 *
 * tests/unit/migration-numbering.test.ts runs the same checks in CI's "Migration numbering guard" step.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MIGRATIONS = join('electron', 'main', 'db', 'migrations')
export const RUNNER = join('electron', 'main', 'db', 'index.ts')

/** Numbers that never shipped a file; frozen, so a new gap fails. 086: #294 landed 087 before #180 (088). */
export const HISTORICAL_GAPS = [16, 17, 59, 81, 84, 86]

export const numberOf = (name) => Number(/^(\d{3})_/.exec(name)?.[1] ?? NaN)
const pad = (n) => String(n).padStart(3, '0')

/** LATEST_DB_VERSION as the runner declares it. */
export const latestOf = (runner) => Number(/export const LATEST_DB_VERSION = (\d+)/.exec(runner)?.[1] ?? NaN)

/**
 * What is wrong with the migrations' order, one sentence each; empty when they are in order.
 * `files`: the .sql file names in the migrations folder. `latest`: LATEST_DB_VERSION.
 */
export function migrationFindings({ files, latest, gaps = HISTORICAL_GAPS }) {
  const findings = []
  const numbers = [...new Set(files.map(numberOf).filter(Number.isInteger))].sort((a, b) => a - b)
  if (numbers.length === 0) return ['no migration file found']
  const highest = numbers.at(-1)
  const missing = Array.from({ length: highest }, (_, i) => i + 1).filter((n) => !numbers.includes(n) && !gaps.includes(n))
  if (missing.length) {
    const list = missing.map(pad).join(', ')
    findings.push(`merge ${list} first: this tree has ${pad(highest)} but not ${list}. A database that runs ${pad(highest)} skips a lower number for good, so ${list} must reach main before ${pad(highest)} merges`)
  }
  if (!Number.isInteger(latest)) findings.push('LATEST_DB_VERSION is missing from electron/main/db/index.ts')
  else if (latest !== highest) findings.push(`LATEST_DB_VERSION is ${latest}, but the highest migration is ${pad(highest)}: set it to ${highest}`)
  return findings
}

/** The findings for a checkout at `root`. */
export function checkTree(root = '.') {
  const files = readdirSync(join(root, MIGRATIONS)).filter((name) => name.endsWith('.sql'))
  return migrationFindings({ files, latest: latestOf(readFileSync(join(root, RUNNER), 'utf8')) })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const findings = checkTree(process.argv[2] ?? '.')
  for (const finding of findings) console.error(`migration order: ${finding}`)
  if (findings.length === 0) console.log('migration order: every number below the highest is in this tree, and LATEST_DB_VERSION matches it')
  process.exitCode = findings.length ? 1 : 0
}
