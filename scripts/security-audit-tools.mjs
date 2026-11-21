/**
 * Runs `npm audit --package-lock-only --audit-level=high --json` for dev/tooling dependencies,
 * allowing only GHSA-fc5q-39xc-vjpf (picomatch ReDoS, dev-only via vitest/@electron/rebuild,
 * no upstream fix published on npm; production is protected by `security:audit`,
 * `security:audit:bundled`, and `permission-policy.ts` which no longer uses picomatch).
 */
import { execFileSync } from 'node:child_process'

const ALLOWED_ADVISORY = 'GHSA-fc5q-39xc-vjpf'
const HIGH_OR_CRITICAL = new Set(['high', 'critical'])

let raw
try {
  raw = execFileSync('npm', ['audit', '--package-lock-only', '--audit-level=high', '--json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 32 * 1024 * 1024
  })
} catch (error) {
  raw = error.stdout?.toString() ?? ''
}

let report
try {
  report = JSON.parse(raw)
} catch {
  console.error('[security:audit:tools] Failed to parse npm audit JSON output.')
  process.exit(1)
}

if (report?.error || !report?.vulnerabilities || typeof report.vulnerabilities !== 'object') {
  console.error('[security:audit:tools] npm audit returned an error or invalid report.')
  process.exit(1)
}

const vulnerabilities = report.vulnerabilities
const disallowed = []

for (const [pkg, entry] of Object.entries(vulnerabilities)) {
  if (!HIGH_OR_CRITICAL.has(entry?.severity)) continue
  const via = Array.isArray(entry?.via) ? entry.via : []
  if (via.length === 0) {
    disallowed.push(`${pkg} (${entry.severity}: unknown advisory)`)
    continue
  }
  for (const item of via) {
    if (typeof item === 'object' && item !== null) {
      const url = String(item.url ?? '')
      if (HIGH_OR_CRITICAL.has(item.severity) && !url.includes(ALLOWED_ADVISORY)) {
        disallowed.push(`${pkg} (${item.severity}: ${url || item.title || 'unknown'})`)
      }
    } else if (typeof item === 'string' && !(item in vulnerabilities)) {
      disallowed.push(`${pkg} (${entry.severity}: via ${item})`)
    }
  }
}

if (disallowed.length > 0) {
  console.error('[security:audit:tools] Found disallowed high/critical advisories:')
  for (const line of disallowed) console.error(`  - ${line}`)
  process.exit(1)
}

console.log(`[security:audit:tools] OK (no high/critical advisories other than dev-only ${ALLOWED_ADVISORY})`)
