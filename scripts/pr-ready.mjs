/**
 * `npm run pr:ready` (agents maturity M4): the checks a PR passes on its exact head before it may be labelled
 * na-fila. On green it writes <main checkout>/.claude/pr-ready/<HEAD sha>.json, which the PreToolUse hook
 * (.claude/hooks/pr-ready-gate.mjs) looks for before the label.
 *
 *   npm run pr:ready                     the checks for the changes since origin/main
 *   npm run pr:ready -- --base <ref>     another base
 *   npm run pr:ready -- --full           the whole vitest suite locally when a change asks for it (heavy)
 *   npm run pr:ready -- --dry-run        prints the plan, runs nothing, writes nothing
 *
 * The checks:
 * - lint (file sizes and eslint) and typecheck;
 * - the gate tests every PR passes: design-lint (counts and target size) and fs-allowlist;
 * - the tests related to the change (FRONTEND's selector, scripts/related-tests.mjs): vitest --changed, plus the
 *   tests that read changed files from disk, plus the changed test files. tests/android-generated.test.ts is the
 *   `android:generate --check`: it fails when the committed Kotlin is out of date, and runs whenever the protocol,
 *   the design tokens or a mobile catalog changes;
 * - vitest runs under Electron's ABI (scripts/test-electron.mjs) with 2 workers.
 *
 * When a change touches every test (package.json, the vitest or TypeScript config, the test setup), the whole suite
 * is needed and it does not fit in this machine's memory. pr:ready then takes the PR's own CI as the evidence: both
 * "Unit and integration tests" jobs must have passed on this exact head. --full runs it locally instead.
 *
 * The marker vouches for HEAD, so the working tree must be clean: an uncommitted change would be checked but not
 * pushed. The live app's OXESPACE_* and AI_MEMORY_* variables are dropped from every check's environment.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { changedFiles, planRelatedTests } from './related-tests.mjs'

/** Gate tests every PR passes, whatever it changes. */
export const ALWAYS_TESTS = ['tests/design-lint.test.ts', 'tests/design-lint-target-size.test.ts', 'tests/integration/fs-allowlist.test.ts']
export const ANDROID_GENERATED_TEST = 'tests/android-generated.test.ts'
/** Inputs of `npm run android:generate`: a change to one of them needs the committed Kotlin to match. */
const ANDROID_INPUTS = [/^shared\/remote\/protocol\.ts$/, /^src\/design\/tokens\//, /^shared\/locales\/[^/]+\/mobile\.json$/, /^scripts\/android\//]
/** The CI jobs that stand for the whole suite on a head. */
export const CI_UNIT_JOBS = ['Unit and integration tests (linux-x64)', 'Unit and integration tests (windows-x64)']
export const WORKERS = '--maxWorkers=2'

/**
 * The steps for a change. `files`: changed paths. `related`: the selector's plan ({ all, changed, extra }).
 * Each step is { name, kind: 'npm' | 'vitest' | 'ci', args }.
 */
export function buildSteps({ files, related, base = 'origin/main', full = false }) {
  const steps = [
    { name: 'lint (file sizes, eslint)', kind: 'npm', args: ['lint'] },
    { name: 'typecheck', kind: 'npm', args: ['typecheck'] }
  ]
  if (related.all) {
    steps.push(full
      ? { name: 'whole vitest suite (--full)', kind: 'vitest', args: [WORKERS] }
      : { name: 'whole vitest suite: the PR\'s CI unit jobs on this head', kind: 'ci', args: CI_UNIT_JOBS })
    return steps
  }
  const gates = new Set([...ALWAYS_TESTS, ...related.extra])
  if (files.some(file => ANDROID_INPUTS.some(pattern => pattern.test(file)))) gates.add(ANDROID_GENERATED_TEST)
  steps.push({ name: 'gate and read-from-disk tests', kind: 'vitest', args: [...[...gates].sort(), WORKERS] })
  if (related.changed) steps.push({ name: `tests that import a changed file (vitest --changed ${base})`, kind: 'vitest', args: ['--changed', base, '--passWithNoTests', WORKERS] })
  return steps
}

/**
 * Whether CI stands for the whole suite on `sha`: every job in `jobs` has a completed, successful check run there
 * (the latest one per name). `checkRuns`: [{ name, status, conclusion, started_at }].
 */
export function ciEvidence(checkRuns, jobs = CI_UNIT_JOBS) {
  const latest = new Map()
  for (const run of checkRuns ?? []) {
    const known = latest.get(run.name)
    if (!known || String(run.started_at ?? '') >= String(known.started_at ?? '')) latest.set(run.name, run)
  }
  const missing = []
  for (const job of jobs) {
    const run = latest.get(job)
    if (!run) missing.push(`${job}: not run on this head`)
    else if (run.status !== 'completed') missing.push(`${job}: still ${run.status}`)
    else if (run.conclusion !== 'success') missing.push(`${job}: ${run.conclusion}`)
  }
  return { ok: missing.length === 0, missing }
}

/** The marker the gate reads: <main checkout>/.claude/pr-ready/<sha>.json. `commonDir` is git's common dir. */
export function markerPath(commonDir, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a commit sha: ${sha}`)
  return join(dirname(commonDir), '.claude', 'pr-ready', `${sha}.json`)
}

/** The environment for a check: no variable of the live app. */
export function checkEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !/^(OXESPACE|AI_MEMORY)_/i.test(name)))
}

export function parseArgs(argv) {
  const options = { base: 'origin/main', full: false, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--full') options.full = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--base') {
      options.base = argv[++i]
      if (!options.base || options.base.startsWith('-')) throw new Error('--base needs a ref')
    } else throw new Error(`unknown option ${arg}`)
  }
  return options
}

const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim()

function runStep(step, env) {
  const here = dirname(fileURLToPath(import.meta.url))
  let command
  let args
  if (step.kind === 'npm') {
    // npm's own CLI when run through `npm run`; otherwise the npm on PATH (through the shell on Windows).
    const npmCli = process.env.npm_execpath
    if (npmCli && /\.c?js$/.test(npmCli)) [command, args] = [process.execPath, [npmCli, 'run', ...step.args]]
    else [command, args] = [process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', ...step.args]]
  } else if (step.kind === 'vitest') {
    [command, args] = [process.execPath, [join(here, 'test-electron.mjs'), ...step.args]]
  } else {
    return { ok: false, detail: 'not a local step' }
  }
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: command.endsWith('.cmd') })
  return { ok: result.status === 0, detail: result.error ? result.error.message : `exit ${result.status}` }
}

function ciStep(step, sha) {
  let checkRuns = []
  try {
    const repo = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { encoding: 'utf8' }).trim()
    const out = execFileSync('gh', ['api', '--paginate', '--slurp', `repos/${repo}/commits/${sha}/check-runs?per_page=100`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    checkRuns = JSON.parse(out).flatMap(page => page.check_runs ?? [])
  } catch (error) {
    return { ok: false, detail: `could not read CI for ${sha.slice(0, 8)}: ${String(error.message ?? error).split('\n')[0]}` }
  }
  const evidence = ciEvidence(checkRuns, step.args)
  return { ok: evidence.ok, detail: evidence.ok ? `CI green on ${sha.slice(0, 8)}` : `${evidence.missing.join('; ')}. Push, wait for CI, or run with --full` }
}

function main(argv) {
  const options = parseArgs(argv)
  const dirty = git(['status', '--porcelain'])
  if (dirty && !options.dryRun) {
    console.error(`pr:ready checks HEAD, and the working tree has changes. Commit or drop them first:\n${dirty}`)
    return 1
  }
  const sha = git(['rev-parse', 'HEAD'])
  const commonDir = resolve(git(['rev-parse', '--git-common-dir']))
  const marker = markerPath(isAbsolute(commonDir) ? commonDir : resolve(commonDir), sha)
  const files = changedFiles(options.base)
  const related = planRelatedTests(files)
  const steps = buildSteps({ files, related, base: options.base, full: options.full })

  console.log(`pr:ready for ${sha.slice(0, 8)} (${files.length} file(s) changed since ${options.base}):`)
  for (const step of steps) console.log(`  - ${step.name}${step.kind === 'vitest' ? `: ${step.args.join(' ')}` : ''}`)
  for (const reason of related.reasons ?? []) console.log(`    (${reason})`)
  if (options.dryRun) return 0

  // A marker from an earlier run on this head is stale until this run passes.
  rmSync(marker, { force: true })
  const env = checkEnv()
  const results = []
  for (const step of steps) {
    console.log(`\n=== pr:ready: ${step.name}`)
    const result = step.kind === 'ci' ? ciStep(step, sha) : runStep(step, env)
    results.push({ name: step.name, ...result })
    if (!result.ok) break
  }
  console.log('\npr:ready summary:')
  for (const result of results) console.log(`  ${result.ok ? 'ok  ' : 'FAIL'} ${result.name} (${result.detail})`)
  const ok = results.length === steps.length && results.every(result => result.ok)
  if (!ok) {
    console.log(`pr:ready FAILED for ${sha.slice(0, 8)}: no marker written.`)
    return 1
  }
  mkdirSync(dirname(marker), { recursive: true })
  writeFileSync(marker, `${JSON.stringify({ ok: true, sha, at: new Date().toISOString(), base: options.base, steps: results.map(r => r.name) }, null, 2)}\n`)
  console.log(`pr:ready OK for ${sha.slice(0, 8)}: wrote ${marker}`)
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(`pr:ready: ${error.message}`)
    process.exitCode = 1
  }
}
