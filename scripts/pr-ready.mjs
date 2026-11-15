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
 * A checkout with no node_modules (a worktree that shares none) cannot run eslint or tsc. There, and only there, lint and
 * typecheck are proven by the PR's CI "Quick checks" job, completed with success on this exact head; the marker then
 * records `lint: "ci:<run id>"`; the gate and related tests likewise come from both CI "Unit and integration tests" jobs
 * on this exact head, recorded as `tests: "ci:<linux job>,<windows job>"` (TECH LEAD, 08/11). A checkout that has node_modules always runs them locally, even
 * when they fail for a missing package or config.
 *
 * The origin gate comes first (OXE-138; the user's rule of 14/11: nothing is implemented unless it comes from
 * /oxe-quick or oxe-execute): with an oxe.config.json in the checkout, `oxe-cc ship check-origin <base>..HEAD` must
 * pass, so every commit since the cut carries OXE-Quick/OXE-Card or OXE-Task/OXE-Run, or an exemption written in
 * that file. The CLI comes from OXE_CC (the path of oxe-cc.js) until oxe-cc 1.21.2 is published; without it the step
 * fails and says so. A branch made before the gate has no oxe.config.json and is not charged.
 *
 * The marker vouches for HEAD, so the working tree must be clean: an uncommitted change would be checked but not
 * pushed. The live app's OXESPACE_* and AI_MEMORY_* variables are dropped from every check's environment.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { changedFiles, planRelatedTests } from './related-tests.mjs'
import { isTrainUpdate } from './merge-train.mjs'

/** Gate tests every PR passes, whatever it changes. */
export const ALWAYS_TESTS = ['tests/design-lint.test.ts', 'tests/design-lint-target-size.test.ts', 'tests/integration/fs-allowlist.test.ts']
export const ANDROID_GENERATED_TEST = 'tests/android-generated.test.ts'
/** Inputs of `npm run android:generate`: a change to one of them needs the committed Kotlin to match. */
const ANDROID_INPUTS = [/^shared\/remote\/protocol\.ts$/, /^src\/design\/tokens\//, /^shared\/locales\/[^/]+\/mobile\.json$/, /^scripts\/android\//]
/** The CI jobs that stand for the whole suite on a head. */
export const CI_UNIT_JOBS = ['Unit and integration tests (linux-x64)', 'Unit and integration tests (windows-x64)']
/**
 * Whether npm installed this checkout's dependencies: npm writes node_modules/.package-lock.json on every install. A
 * node_modules folder holding only a tool's cache (.vite) is not an install.
 */
export const npmInstalled = (root, exists = existsSync) => exists(join(root, 'node_modules', '.package-lock.json'))

/** The CI job that runs `npm run typecheck` and `npm run lint` (ci.yml quick). */
export const CI_LINT_JOB = 'Quick checks (linux-x64)'
export const WORKERS = '--maxWorkers=2'

/**
 * The steps for a change. `files`: changed paths. `related`: the selector's plan ({ all, changed, extra }).
 * Each step is { name, kind: 'npm' | 'vitest' | 'ci', args }.
 */
/** The visual suite's baselines: e2e/visual/__screenshots__/<linux|win32>/…png. */
const VISUAL_BASELINE = /^e2e\/visual\/__screenshots__\/(linux|win32)\/.+\.png$/
/** Other committed snapshot images (Android goldens and the like): no workflow regenerates them, so CI decides. */
const OTHER_SNAPSHOT = /(^|\/)(__screenshots__|__snapshots__|snapshots)\/.+\.png$/
const PACKAGE_FILE = /(^|\/)package(-lock)?\.json$/
export const VISUAL_WORKFLOW = 'visual-baselines.yml'

/**
 * What kind of change this is, which decides how it is proven (TECH LEAD, 07/11):
 * - 'images': only visual baselines; a green visual-baselines.yml run on this sha, for each platform touched;
 * - 'packages': only package.json / package-lock.json files, or only other snapshot images; the PR's own CI;
 * - 'code': anything else; the local checks.
 * Neither of the first two needs node_modules.
 */
export function classifyChange(files) {
  if (files.length && files.every(file => VISUAL_BASELINE.test(file))) return 'images'
  if (files.length && files.every(file => PACKAGE_FILE.test(file) || OTHER_SNAPSHOT.test(file))) return 'packages'
  return 'code'
}

/** The platforms whose visual baselines a change touches, as visual-baselines.yml names them. */
export function visualPlatforms(files) {
  return [...new Set(files.map(file => VISUAL_BASELINE.exec(file)?.[1]).filter(Boolean).map(dir => (dir === 'win32' ? 'windows' : dir)))].sort()
}

/** The versioned origin config (oxe-cc G19): its presence turns the origin gate on for the checkout. */
export const ORIGIN_CONFIG = 'oxe.config.json'

/**
 * The command that runs oxe-cc, from OXE_CC: a .js/.cjs/.mjs path runs under this Node, anything else as a binary.
 * Null when OXE_CC is not set; the origin step then fails and says how to set it.
 */
export function oxeCcCommand(env = process.env) {
  const cli = env.OXE_CC?.trim()
  if (!cli) return null
  return /\.(c|m)?js$/i.test(cli) ? { command: process.execPath, args: [cli] } : { command: cli, args: [] }
}

/**
 * The brand fidelity gate (OXE-148; the user's rule of 14/11: the release is faithful to the rebranding end to end,
 * and an interface PR enters only with the conformance test and MARCA green). A PR that touches the interface needs
 * these commit statuses green on its exact head: `marca/conformidade`, posted by CI's brand conformance job (the built
 * app measured against src/design/targets; OXE-149), and `marca/fidelidade`, posted by MARCA after the side-by-side
 * check against the approved target, for what the test does not measure.
 */
export const BRAND_CONTEXTS = ['marca/conformidade', 'marca/fidelidade']
const INTERFACE_PATHS = [
  /^src\/.+\.(tsx|css)$/,
  /^src\/(design|styles|ui)\//,
  /^mobile\/android\/app\/src\/main\/(java\/.+\/ui\/|res\/)/,
  /^mobile\/android\/app\/src\/test\/snapshots\//,
  /^e2e\/visual\/__screenshots__\//
]
/** Whether a change touches the interface, which then needs the brand statuses. */
export const touchesInterface = files => files.some(file => INTERFACE_PATHS.some(pattern => pattern.test(file)))

/** Each brand context green at its latest status on the head; `statuses` as GitHub lists them, newest first. */
export function brandEvidence(statuses, contexts = BRAND_CONTEXTS) {
  const latest = new Map()
  for (const status of statuses ?? []) if (!latest.has(status.context)) latest.set(status.context, status)
  const missing = contexts.filter(context => latest.get(context)?.state !== 'success').map(context => {
    const status = latest.get(context)
    return status ? `${context} is ${status.state}${status.description ? ` (${status.description})` : ''}` : `${context} has not been posted`
  })
  return { ok: missing.length === 0, missing }
}

/**
 * The brand evidence across the train's own updates (OXE-276). When the merge train brings a car up to date it adds a
 * merge of main on top of the head MARCA approved; a car that then leaves the queue (say, an infrastructure failure)
 * comes back with that merge as its head and no marca/fidelidade on it. `chain` is the head first, then each parent
 * reached through train updates only (`isTrainUpdate`), each `{ sha, statuses }`. For each context the newest commit
 * that carries it decides: the CI's marca/conformidade of the merge head, MARCA's marca/fidelidade of the head it
 * approved. Any other commit after the approved head (a change of the author's) ends the chain, so it fails.
 */
export function brandEvidenceAcross(chain, contexts = BRAND_CONTEXTS) {
  const found = new Map()
  for (const link of chain ?? []) {
    const latest = new Map()
    for (const status of link.statuses ?? []) if (!latest.has(status.context)) latest.set(status.context, status)
    for (const context of contexts) if (!found.has(context) && latest.has(context)) found.set(context, { status: latest.get(context), sha: link.sha })
  }
  const missing = contexts.filter(context => found.get(context)?.status.state !== 'success').map(context => {
    const entry = found.get(context)
    return entry ? `${context} is ${entry.status.state}${entry.status.description ? ` (${entry.status.description})` : ''}` : `${context} has not been posted`
  })
  const via = contexts.map(context => found.get(context)?.sha).filter(Boolean)
  return { ok: missing.length === 0, missing, from: [...new Set(via)] }
}

/**
 * The steps for a change: the origin gate first when the checkout has an oxe.config.json, and the brand gate last
 * (a GitHub step, read fresh) when the change touches the interface.
 */
export function buildSteps({ origin = false, base = 'origin/main', ...rest }) {
  const steps = changeSteps({ base, ...rest })
  if (touchesInterface(rest.files ?? [])) steps.push({ name: `brand fidelity: ${BRAND_CONTEXTS.join(', ')} green on this head (CI and MARCA)`, kind: 'brand', args: [...BRAND_CONTEXTS] })
  return origin ? [{ name: `origin of every commit since the cut (oxe-cc ship check-origin ${base}..HEAD)`, kind: 'origin', args: [`${base}..HEAD`] }, ...steps] : steps
}

function changeSteps({ files, related, base = 'origin/main', full = false, nodeModules = true }) {
  const kind = classifyChange(files)
  if (kind === 'images') {
    const platforms = visualPlatforms(files)
    return [{ name: `visual-baselines.yml green on this head (${platforms.join(', ')})`, kind: 'visual', args: platforms }]
  }
  if (kind === 'packages') return [{ name: 'packages only: the PR\'s CI unit jobs on this head', kind: 'ci', args: CI_UNIT_JOBS }]
  const steps = nodeModules
    ? [
        { name: 'lint (file sizes, eslint)', kind: 'npm', args: ['lint'] },
        { name: 'typecheck', kind: 'npm', args: ['typecheck'] }
      ]
    : [{ name: `lint and typecheck: the PR's CI "${CI_LINT_JOB}" on this head (no local node_modules)`, kind: 'ci-lint', args: [CI_LINT_JOB] }]
  if (related.all) {
    steps.push(full
      ? { name: 'whole vitest suite (--full)', kind: 'vitest', args: [WORKERS] }
      : { name: 'whole vitest suite: the PR\'s CI unit jobs on this head', kind: 'ci', args: CI_UNIT_JOBS })
    return steps
  }
  if (!nodeModules) {
    steps.push({ name: "gate and related tests: the PR's CI unit jobs on this head (no local node_modules)", kind: 'ci-tests', args: CI_UNIT_JOBS })
    return steps
  }
  const gates = new Set([...ALWAYS_TESTS, ...related.extra])
  if (files.some(file => ANDROID_INPUTS.some(pattern => pattern.test(file)))) gates.add(ANDROID_GENERATED_TEST)
  steps.push({ name: 'gate and read-from-disk tests', kind: 'vitest', args: [...[...gates].sort(), WORKERS] })
  if (related.changed) steps.push({ name: `tests that import a changed file (vitest --changed ${base})`, kind: 'vitest', args: ['--changed', base, '--passWithNoTests', WORKERS] })
  return steps
}

/** The Actions run id behind a check run, from its details or html link (".../actions/runs/<id>/job/..."). */
export const runIdOf = (checkRun) => Number(/\/actions\/runs\/(\d+)/.exec(String(checkRun?.details_url ?? checkRun?.html_url ?? ''))?.[1]) || null

/**
 * Whether CI stands for the whole suite on `sha`: every job in `jobs` has a completed, successful check run there
 * (the latest one per name), traceable to its Actions run. `checkRuns`: [{ name, status, conclusion, started_at,
 * head_sha, details_url }], read from GitHub for that sha. Returns the run ids that prove it.
 */
export function ciEvidence(checkRuns, jobs = CI_UNIT_JOBS, sha = null) {
  const latest = new Map()
  for (const run of checkRuns ?? []) {
    if (sha && run.head_sha && run.head_sha !== sha) continue
    const known = latest.get(run.name)
    if (!known || String(run.started_at ?? '') >= String(known.started_at ?? '')) latest.set(run.name, run)
  }
  const missing = []
  const runs = []
  const jobIds = []
  for (const job of jobs) {
    const run = latest.get(job)
    if (!run) missing.push(`${job}: not run on this head`)
    else if (run.status !== 'completed') missing.push(`${job}: still ${run.status}`)
    else if (run.conclusion !== 'success') missing.push(`${job}: ${run.conclusion}`)
    else if (!runIdOf(run)) missing.push(`${job}: no Actions run to point to`)
    else {
      runs.push(runIdOf(run))
      jobIds.push(run.id ?? runIdOf(run))
    }
  }
  return missing.length ? { ok: false, missing, runs: [], jobs: [] } : { ok: true, missing, runs: [...new Set(runs)], jobs: jobIds }
}

/**
 * Whether visual-baselines.yml proves `sha` for every platform in `platforms`: the latest run per platform on that
 * exact sha completed with success (its generate and both stable verifies passed). `runs`: the workflow's runs,
 * [{ id, head_sha, status, conclusion, display_title, created_at }]; the platform is in the run title
 * ("Visual baselines · <platform> · <ref>").
 */
export function visualEvidence(runs, platforms, sha) {
  const missing = []
  const ids = []
  for (const platform of platforms) {
    const mine = (runs ?? [])
      .filter(run => run.head_sha === sha && String(run.display_title ?? '').startsWith(`Visual baselines · ${platform} ·`))
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    const run = mine[0]
    if (!run) missing.push(`${platform}: no ${VISUAL_WORKFLOW} run on this head (dispatch it with platform=${platform} on the PR branch)`)
    else if (run.status !== 'completed') missing.push(`${platform}: run ${run.id} still ${run.status}`)
    else if (run.conclusion !== 'success') missing.push(`${platform}: run ${run.id} ${run.conclusion}`)
    else ids.push(run.id)
  }
  return missing.length ? { ok: false, missing, runs: [] } : { ok: true, missing, runs: ids }
}

/**
 * The marker's content: how the head was proven, and the runs that prove it. `evidence`: 'local' (the checks ran
 * here), 'ci' (the PR's CI unit jobs) or 'images' (visual-baselines.yml). `runs`: the Actions run ids, for ci and images.
 */
export function markerContent({ sha, at, base, steps, evidence = 'local', runs = [], lint = null, tests = null }) {
  return { ok: true, sha, at, evidence, runs, base, steps, ...(lint ? { lint } : {}), ...(tests ? { tests } : {}) }
}

/**
 * How the head was proven, from the passed steps: a GitHub step's own evidence when there is one (ci or images);
 * otherwise "ci" when every step came from CI (no local node_modules: lint and tests from the PR's jobs), with
 * those Actions runs; otherwise "local".
 */
export function markerEvidence(results) {
  const proof = results.find(result => result.evidence)
  if (proof) return { evidence: proof.evidence, runs: proof.runs ?? [] }
  const fromCi = results.length > 0 && results.every(result => result.ciRuns)
  return fromCi ? { evidence: 'ci', runs: [...new Set(results.flatMap(result => result.ciRuns))] } : { evidence: 'local', runs: [] }
}

/**
 * Writes the marker atomically (OXE-115): the content goes to a temporary file next to it, renamed over the marker
 * only once it is complete, so a reader never sees a half-written marker and an earlier one stays until the swap.
 */
export function writeMarker(marker, content, fs = { mkdirSync, writeFileSync, renameSync }) {
  fs.mkdirSync(dirname(marker), { recursive: true })
  const temporary = `${marker}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(content, null, 2)}\n`)
  fs.renameSync(temporary, marker)
}

/**
 * The line a failed run ends with (OXE-115). A run that fails leaves the marker of an earlier passing run on the same
 * head in place: that run proved this exact commit, and a failure here (often the network or a status not posted yet)
 * does not undo it.
 */
export function failedRunLine(sha, marker, exists = existsSync) {
  return exists(marker)
    ? `pr:ready FAILED for ${sha.slice(0, 8)}: this run failed; the marker of an earlier passing run on this head stands (${marker}).`
    : `pr:ready FAILED for ${sha.slice(0, 8)}: no marker written.`
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
  } else if (step.kind === 'origin') {
    const cli = oxeCcCommand(env)
    if (!cli) return { ok: false, detail: 'oxe-cc not found: set OXE_CC to the path of oxe-cc.js (oxe-build ≥ 1.21.2), the origin gate of OXE-138' }
    ;[command, args] = [cli.command, [...cli.args, 'ship', 'check-origin', ...step.args]]
  } else {
    return { ok: false, detail: 'not a local step' }
  }
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: command.endsWith('.cmd') })
  return { ok: result.status === 0, detail: result.error ? result.error.message : `exit ${result.status}` }
}

/** A network failure, worth another try (the same list as .claude/hooks/net-retry.sh). Anything else is an answer. */
export const NETWORK_FAILURE = /TLS|SSL|unexpected eof|Connection (was )?reset|connection reset|timed? ?out|Timeout|Could not resolve|resolve host|getaddrinfo|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|HTTP 5\d\d|HTTP 429|502 Bad Gateway|503 Service|504 Gateway|error connecting to api\.github\.com|i\/o timeout/i

/**
 * Runs `run()` again after a network failure, up to `tries` times with a doubling wait (3 s, then 6, 12, 24): an
 * unstable network must never turn into "CI not green". Any other failure is thrown at once.
 */
export function withNetworkRetry(run, { tries = 5, wait = 3000, sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms), log = () => {} } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return run()
    } catch (error) {
      const text = `${error?.message ?? ''}\n${error?.stderr ?? ''}`
      if (attempt >= tries || !NETWORK_FAILURE.test(text)) throw error
      log(`network failure (try ${attempt}/${tries}), retrying in ${wait / 1000}s`)
      sleep(wait)
      wait = Math.min(wait * 2, 60_000)
    }
  }
}

const gh = args => withNetworkRetry(() => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }), { log: line => console.log(`  ${line}`) })
const readFailed = (what, sha, error) => ({ ok: false, detail: `could not read ${what} for ${sha.slice(0, 8)} (no marker written; run pr:ready again): ${String(error.stderr || error.message || error).split('\n')[0]}` })

function checkRunsOf(sha) {
  const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim()
  return JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/commits/${sha}/check-runs?per_page=100`])).flatMap(page => page.check_runs ?? [])
}

/** Lint and typecheck from CI, for a checkout with no node_modules: the Quick checks job on this exact head. */
function ciLintStep(step, sha) {
  let checkRuns
  try {
    checkRuns = checkRunsOf(sha)
  } catch (error) {
    return readFailed('CI', sha, error)
  }
  const evidence = ciEvidence(checkRuns, step.args, sha)
  return evidence.ok
    ? { ok: true, lint: `ci:${evidence.runs[0]}`, ciRuns: evidence.runs, detail: `${CI_LINT_JOB} green on ${sha.slice(0, 8)}: run ${evidence.runs[0]}` }
    : { ok: false, detail: `${evidence.missing.join('; ')}. Push and wait for CI, or run pr:ready where node_modules is installed` }
}

/**
 * The gate and related tests from CI, for a checkout with no node_modules: both "Unit and integration tests" jobs
 * completed with success on this exact head (a job in progress, skipped or cancelled does not count). `tests` names
 * the two jobs, linux then windows.
 */
function ciTestsStep(step, sha) {
  let checkRuns
  try {
    checkRuns = checkRunsOf(sha)
  } catch (error) {
    return readFailed('CI', sha, error)
  }
  const evidence = ciEvidence(checkRuns, step.args, sha)
  return evidence.ok
    ? { ok: true, tests: `ci:${evidence.jobs.join(',')}`, ciRuns: evidence.runs, detail: `CI unit jobs green on ${sha.slice(0, 8)}: job(s) ${evidence.jobs.join(', ')}` }
    : { ok: false, detail: `${evidence.missing.join('; ')}. Push and wait for CI, or run pr:ready where node_modules is installed` }
}

function ciStep(step, sha) {
  let checkRuns
  try {
    checkRuns = checkRunsOf(sha)
  } catch (error) {
    return readFailed('CI', sha, error)
  }
  const evidence = ciEvidence(checkRuns, step.args, sha)
  return evidence.ok
    ? { ok: true, evidence: 'ci', runs: evidence.runs, detail: `CI green on ${sha.slice(0, 8)}: run(s) ${evidence.runs.join(', ')}` }
    : { ok: false, detail: `${evidence.missing.join('; ')}. Push, wait for CI, or run with --full` }
}

function brandStep(step, sha) {
  const chain = []
  try {
    const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim()
    let current = sha
    // The head, then back through the train's own update merges only (OXE-276), at most 10 of them.
    for (let hop = 0; hop <= 10 && current; hop++) {
      const statuses = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/commits/${current}/statuses?per_page=100`])).flat()
      chain.push({ sha: current, statuses })
      const commit = JSON.parse(gh(['api', `repos/${repo}/commits/${current}`, '--jq', '{message: .commit.message, parents: [.parents[].sha]}']))
      current = isTrainUpdate(commit) ? commit.parents[0] : null
    }
  } catch (error) {
    return readFailed('the brand statuses', sha, error)
  }
  const evidence = brandEvidenceAcross(chain, step.args)
  const via = evidence.from.filter(from => from !== sha).map(from => from.slice(0, 8))
  return evidence.ok
    ? { ok: true, detail: `${step.args.join(', ')} green on ${sha.slice(0, 8)}${via.length ? ` (approved on ${via.join(', ')}, before the train's merge of main)` : ''}` }
    : { ok: false, detail: `${evidence.missing.join('; ')}. An interface change needs MARCA's side-by-side check against the target (oxespace-3d posts marca/fidelidade on the exact head)` }
}

function visualStep(step, sha) {
  let runs
  try {
    const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim()
    runs = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/actions/workflows/${VISUAL_WORKFLOW}/runs?head_sha=${sha}&per_page=100`])).flatMap(page => page.workflow_runs ?? [])
  } catch (error) {
    return readFailed(VISUAL_WORKFLOW, sha, error)
  }
  const evidence = visualEvidence(runs, step.args, sha)
  return evidence.ok
    ? { ok: true, evidence: 'images', runs: evidence.runs, detail: `${VISUAL_WORKFLOW} green on ${sha.slice(0, 8)}: run(s) ${evidence.runs.join(', ')}` }
    : { ok: false, detail: evidence.missing.join('; ') }
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
  const top = git(['rev-parse', '--show-toplevel'])
  const nodeModules = npmInstalled(top)
  const origin = existsSync(join(top, ORIGIN_CONFIG))
  const steps = buildSteps({ files, related, base: options.base, full: options.full, nodeModules, origin })

  console.log(`pr:ready for ${sha.slice(0, 8)} (${files.length} file(s) changed since ${options.base}):`)
  for (const step of steps) console.log(`  - ${step.name}${step.kind === 'vitest' ? `: ${step.args.join(' ')}` : ''}`)
  for (const reason of related.reasons ?? []) console.log(`    (${reason})`)
  if (options.dryRun) return 0

  const env = checkEnv()
  const results = []
  for (const step of steps) {
    console.log(`\n=== pr:ready: ${step.name}`)
    const result = step.kind === 'ci' ? ciStep(step, sha) : step.kind === 'ci-lint' ? ciLintStep(step, sha) : step.kind === 'ci-tests' ? ciTestsStep(step, sha) : step.kind === 'visual' ? visualStep(step, sha) : step.kind === 'brand' ? brandStep(step, sha) : runStep(step, env)
    results.push({ name: step.name, ...result })
    if (!result.ok) break
  }
  console.log('\npr:ready summary:')
  for (const result of results) console.log(`  ${result.ok ? 'ok  ' : 'FAIL'} ${result.name} (${result.detail})`)
  const ok = results.length === steps.length && results.every(result => result.ok)
  if (!ok) {
    console.log(failedRunLine(sha, marker))
    return 1
  }
  // A GitHub step, when there is one, is the last step: its conclusions were read just now, never cached.
  const content = markerContent({ sha, at: new Date().toISOString(), base: options.base, steps: results.map(r => r.name), ...markerEvidence(results), lint: results.find(result => result.lint)?.lint, tests: results.find(result => result.tests)?.tests })
  writeMarker(marker, content)
  console.log(`pr:ready OK for ${sha.slice(0, 8)}: wrote ${marker}`)
  // The same verdict where GitHub (and the merge train) can read it: a `pr:ready` commit status on this exact sha.
  const posted = postStatus(sha, content)
  console.log(posted.ok ? `posted the ${STATUS_CONTEXT} status on ${sha.slice(0, 8)}` : `pr:ready: the ${STATUS_CONTEXT} status was NOT posted (${posted.detail}). The local marker stands; run pr:ready again once the head is pushed.`)
  return posted.ok ? 0 : 1
}

/** The commit status pr:ready posts, so the merge train can tell a head that passed it from one that did not. */
export const STATUS_CONTEXT = 'pr:ready'

/** The status body for a marker: success, the evidence kind and its runs in the description (GitHub caps it at 140). */
export function statusBody(content, repo) {
  const runs = content.runs ?? []
  const description = `${content.evidence}${runs.length ? `: run ${runs.join(', ')}` : `: ${content.steps.length} local step(s)`}${content.lint ? ` · lint ${content.lint}` : ''}${content.tests ? ` · tests ${content.tests}` : ''}`.slice(0, 140)
  const body = { state: 'success', context: STATUS_CONTEXT, description }
  if (runs.length && repo) body.target_url = `https://github.com/${repo}/actions/runs/${runs[0]}`
  return body
}

function postStatus(sha, content) {
  try {
    const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim()
    const body = statusBody(content, repo)
    const args = ['api', '-X', 'POST', `repos/${repo}/statuses/${sha}`]
    for (const [key, value] of Object.entries(body)) args.push('-f', `${key}=${value}`)
    gh(args)
    return { ok: true }
  } catch (error) {
    const text = String(error.stderr || error.message || error)
    return { ok: false, detail: /422|No commit found/i.test(text) ? `${sha.slice(0, 8)} is not on GitHub yet: push it first` : text.split('\n')[0] }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (error) {
    console.error(`pr:ready: ${error.message}`)
    process.exitCode = 1
  }
}
