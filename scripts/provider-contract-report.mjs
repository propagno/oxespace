#!/usr/bin/env node
/**
 * Joins the provider probe reports of the nightly contract run (one per OS) into
 * compatibility.json and the text of the `provider-contract` issue.
 *
 *   node scripts/provider-contract-report.mjs <reports dir> <compatibility.json> <issue.md>
 *
 * Exit code 1 when a required check failed on any OS; the workflow opens or
 * updates the issue then, and closes it when the contract holds again.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Codex reports its version inside a user agent ("oxespace-probe/0.163.0 (Ubuntu …)"); keep the version alone. */
export const versionOf = version => version ? String(version).match(/\d+\.\d+\.\d+(?:-[\w.]+)?/)?.[0] ?? String(version) : null

/**
 * `expected` names the OSes that must report; a missing one counts as a failure, so a probe that crashed is not
 * mistaken for a passing one.
 * @param {{ os: string, checkedAt: string, reports: { provider: string, version?: string | null, results: { name: string, ok: boolean, required: boolean, detail?: string }[] }[] }[]} runs */
export function summarize(runs, expected = []) {
  const providers = {}
  const failures = expected.filter(os => !runs.some(run => run.os === os)).map(os => ({ os, provider: 'probe', version: null, check: 'no report was produced', detail: 'the probe did not run to the end; see the job log' }))
  for (const run of runs) {
    for (const report of run.reports) {
      const entry = providers[report.provider] ??= { versions: {}, ok: true }
      entry.versions[run.os] = versionOf(report.version)
      for (const result of report.results) {
        if (result.ok || !result.required) continue
        entry.ok = false
        failures.push({ os: run.os, provider: report.provider, version: versionOf(report.version), check: result.name, detail: result.detail ?? '' })
      }
    }
  }
  const checkedAt = runs.map(run => run.checkedAt).sort().at(-1) ?? null
  return { checkedAt, ok: failures.length === 0 && runs.length > 0, providers, failures }
}

export function issueBody(summary, runUrl) {
  const lines = ['The nightly contract check against the provider CLIs failed. Thread mode may not work with these versions.', '']
  for (const failure of summary.failures) lines.push(`- **${failure.provider} ${failure.version ?? '(version unknown)'}** on ${failure.os}: ${failure.check}${failure.detail ? ` — ${failure.detail}` : ''}`)
  lines.push('', `Run: ${runUrl}`, '', 'This issue is closed automatically when the check passes again.')
  return lines.join('\n')
}

function main() {
  const [directory, compatibilityPath, issuePath] = process.argv.slice(2)
  const runs = readdirSync(directory, { recursive: true }).filter(name => String(name).endsWith('.json')).map(name => {
    const path = join(directory, String(name))
    const os = String(name).match(/report-([\w-]+)\.json$/)?.[1] ?? 'unknown'
    return { os, ...JSON.parse(readFileSync(path, 'utf8')) }
  })
  const summary = summarize(runs, (process.env.PROBE_OS ?? '').split(',').filter(Boolean))
  writeFileSync(compatibilityPath, JSON.stringify(summary, null, 2) + '\n')
  writeFileSync(issuePath, issueBody(summary, process.env.RUN_URL ?? ''))
  console.log(summary.ok ? '[contract] every required check passed' : `[contract] ${summary.failures.length} required check(s) failed`)
  process.exit(summary.ok ? 0 : 1)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) main()
