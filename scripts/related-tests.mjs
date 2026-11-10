/**
 * pr:ready's test selector (agents maturity M4): which vitest tests a change needs before na-fila.
 *
 * Vitest's own `--changed <ref>` runs the tests whose import graph reaches a changed file. This adds what the graph
 * can't see:
 * - files the gate tests read from disk (CSS, design tokens, locale catalogs, the remote protocol);
 * - changes that touch every test (dependencies, the vitest or TypeScript config, the test setup), which ask for the
 *   whole suite.
 *
 * Usage:
 *   node scripts/related-tests.mjs [--base origin/main] [--json]   prints the plan
 *   node scripts/related-tests.mjs [--base origin/main] --run      runs it under Electron's ABI (test-electron), 2 workers
 * Import `planRelatedTests(files)` to use the plan elsewhere (SRE's `npm run pr:ready`).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** A change to one of these can break any test: run them all. */
const EVERYTHING = [
  /^package(-lock)?\.json$/, /^vitest\.config\.[cm]?[jt]s$/, /^tsconfig[\w.-]*\.json$/, /^tests\/setup\.[jt]sx?$/
]

/** Gate tests that read files from disk, so `--changed` never links them to the files they read. */
const READ_FROM_DISK = [
  { when: /\.css$/, tests: ['tests/design-lint.test.ts', 'tests/design-lint-target-size.test.ts'] },
  { when: /^src\/design\/tokens\//, tests: ['tests/design-tokens.test.ts', 'tests/design-lint.test.ts', 'tests/android-generated.test.ts'] },
  { when: /^shared\/locales\//, tests: ['tests/i18n-catalog.test.ts', 'tests/code-i18n.test.ts', 'tests/main-i18n.test.ts'] },
  { when: /^shared\/remote\/protocol\.ts$/, tests: ['tests/android-generated.test.ts'] },
  // A page or component change can move a design-lint count (dialogs, uppercase, selected states, raw buttons).
  { when: /^src\/.*\.tsx$/, tests: ['tests/design-lint.test.ts'] }
]

const TEST_FILE = /^tests\/.*\.(test|spec)\.[cm]?[jt]sx?$/

/**
 * The plan for a list of changed paths (repository-relative, forward slashes).
 * `all`: run the whole suite. Otherwise `changed` (let vitest follow imports) plus `extra` tests read from disk, and
 * the changed test files themselves.
 */
export function planRelatedTests(files) {
  const paths = [...new Set(files.map(file => file.replace(/\\/g, '/').trim()).filter(Boolean))]
  const reasons = []
  const everything = paths.filter(path => EVERYTHING.some(pattern => pattern.test(path)))
  if (everything.length) return { all: true, changed: false, extra: [], reasons: everything.map(path => `${path} touches every test`) }
  const extra = new Set()
  for (const path of paths) {
    if (TEST_FILE.test(path) && !path.startsWith('tests/acceptance/')) extra.add(path)
    for (const rule of READ_FROM_DISK) {
      if (!rule.when.test(path)) continue
      for (const test of rule.tests) {
        if (!extra.has(test)) reasons.push(`${test} reads ${path}`)
        extra.add(test)
      }
    }
  }
  const code = paths.some(path => /^(src|electron|shared|tests)\//.test(path) && /\.[cm]?[jt]sx?$/.test(path))
  return { all: false, changed: code, extra: [...extra].sort(), reasons }
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).split('\n').map(line => line.trim()).filter(Boolean)
}

/** Committed since the merge base with `base`, plus what is staged, modified or new in the working tree. */
export function changedFiles(base = 'origin/main') {
  return [...new Set([
    ...git(['diff', '--name-only', `${base}...HEAD`]),
    ...git(['diff', '--name-only', 'HEAD']),
    ...git(['ls-files', '--others', '--exclude-standard'])
  ])]
}

function main(argv) {
  const baseAt = argv.indexOf('--base')
  const base = baseAt >= 0 ? argv[baseAt + 1] : 'origin/main'
  const plan = planRelatedTests(changedFiles(base))
  if (!argv.includes('--run')) {
    process.stdout.write(argv.includes('--json') ? `${JSON.stringify(plan, null, 2)}\n` : describe(plan, base))
    return 0
  }
  const runner = fileURLToPath(new URL('./test-electron.mjs', import.meta.url))
  const vitest = args => spawnSync(process.execPath, [runner, ...args, '--maxWorkers=2'], { stdio: 'inherit' }).status ?? 1
  if (plan.all) return vitest([])
  let status = 0
  if (plan.changed) status ||= vitest(['--changed', base, '--passWithNoTests'])
  if (plan.extra.length) status ||= vitest(plan.extra)
  return status
}

function describe(plan, base) {
  if (plan.all) return `Whole suite: ${plan.reasons.join('; ')}\n`
  const lines = [`Tests related to the changes since ${base}:`]
  lines.push(plan.changed ? '  vitest --changed (tests that import a changed file)' : '  no code changed')
  for (const test of plan.extra) lines.push(`  ${test}`)
  return `${lines.join('\n')}\n`
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)))
