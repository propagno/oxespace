// The performance gate's outcome, from the step's own outcome and its Playwright log (OXE-389).
//
// Outside a release, ci.yml accepts only the failures it names in PERF_GATE_KNOWN_FAILURES: each entry is one exact
// test, on one OS, with its error matched whole, and names the open card that fixes it (decision of 23/11, option c).
// A failed gate whose every failure is such an entry is recorded "known": it is printed with its card and does not
// fail the run. Anything else that failed (another error, a timeout, a failed count that does not add up, a crash with
// no summary) stays "failure". An entry leaves the list in the pull request that fixes its measure.
//
//   node scripts/perf-gate-outcome.mjs record  <label> <os> <runner-os> <step-outcome> <log> <out.json>
//   node scripts/perf-gate-outcome.mjs recheck <runner-os> <exit-status> <log>
// Both read the known list from the PERF_GATE_KNOWN_FAILURES environment variable (JSON).
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const normalizeTest = header => header.replace(/\\/g, '/').replace(/^(\S+?\.spec\.ts):\d+:\d+ › /, '$1 › ').trim()

/** The failed tests of a Playwright list-reporter log, each with its error lines, and the summary's counts. */
export function parseFailures(log) {
  const lines = String(log).replace(/\r/g, '').split('\n')
  const blocks = []
  let current = null
  let failed = null
  let other = 0
  for (const line of lines) {
    const head = /^ {2}(\d+)\) (\S+\.spec\.ts:\d+:\d+ › .*)$/.exec(line)
    if (head) {
      const test = normalizeTest(head[2])
      current = blocks.find(block => block.test === test) ?? null
      if (!current) { current = { test, errors: [] }; blocks.push(current) }
      continue
    }
    const count = /^ {2}(\d+) (failed|flaky|passed|skipped|interrupted|did not run)\b/.exec(line)
    if (count) {
      current = null
      if (count[2] === 'failed') failed = Number(count[1])
      else if (count[2] === 'interrupted' || count[2] === 'did not run') other += Number(count[1])
      continue
    }
    if (!current) continue
    const error = /^\s+(Error: .*|Test timeout of \d+ms exceeded.*|Worker teardown timeout.*)$/.exec(line)
    if (error) current.errors.push(error[1].replace(/^Error: /, '').trim())
  }
  return { failed, other, blocks }
}

/**
 * The outcome to record: the step's own, except that a failure made only of known failures (for this OS) is "known".
 * Returns { outcome, known: [{ card, test, error }], unknown: [{ test, error }] }.
 */
export function classifyGate({ outcome, os, log, known = [] }) {
  if (outcome !== 'failure') return { outcome, known: [], unknown: [] }
  const { failed, other, blocks } = parseFailures(log)
  const found = []
  const unknown = []
  for (const block of blocks) {
    if (block.errors.length === 0) unknown.push({ test: block.test, error: '(no error line)' })
    for (const error of block.errors) {
      const entry = known.find(k => k.os === os && k.test === block.test && new RegExp(k.error).test(error))
      if (entry) found.push({ card: entry.card, test: block.test, error })
      else unknown.push({ test: block.test, error })
    }
  }
  const whole = failed !== null && failed > 0 && failed === blocks.length && other === 0
  if (!whole) unknown.push({ test: '(summary)', error: failed === null ? 'no Playwright summary in the log' : `${failed} failed, ${blocks.length} failure block(s), ${other} interrupted or not run` })
  return { outcome: unknown.length === 0 ? 'known' : 'failure', known: found, unknown }
}

const knownFromEnv = () => {
  const text = process.env.PERF_GATE_KNOWN_FAILURES
  return text ? JSON.parse(text) : []
}
const readLog = path => { try { return readFileSync(path, 'utf8') } catch { return '' } }
const describe = result => [
  ...result.known.map(k => `known failure (${k.card}): ${k.test} — ${k.error}`),
  ...result.unknown.map(u => `failure: ${u.test} — ${u.error}`),
]

function main(argv) {
  const [command, ...args] = argv
  if (command === 'record') {
    const [label, os, runnerOs, stepOutcome, logPath, out] = args
    const result = classifyGate({ outcome: stepOutcome || 'skipped', os: runnerOs, log: readLog(logPath), known: knownFromEnv() })
    writeFileSync(out, `${JSON.stringify({ label, os, outcome: result.outcome, known: result.known })}\n`)
    for (const line of describe(result)) console.log(line)
    console.log(`performance gate on ${label}: ${result.outcome}`)
    for (const k of result.known) console.log(`::warning title=Known performance failure (${k.card})::${label}: ${k.test} — ${k.error}. Accepted while ${k.card} is open; the exception leaves with its fix.`)
    return 0
  }
  if (command === 'recheck') {
    const [runnerOs, status, logPath] = args
    const result = classifyGate({ outcome: status === '0' ? 'success' : 'failure', os: runnerOs, log: readLog(logPath), known: knownFromEnv() })
    for (const line of describe(result)) console.log(line)
    for (const k of result.known) console.log(`::warning title=Known performance failure (${k.card})::${k.test} — ${k.error}. Accepted while ${k.card} is open; the exception leaves with its fix.`)
    console.log(`second run: ${result.outcome}`)
    return result.outcome === 'failure' ? 1 : 0
  }
  console.error('usage: perf-gate-outcome.mjs record <label> <os> <runner-os> <step-outcome> <log> <out.json> | recheck <runner-os> <exit-status> <log>')
  return 2
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2))
