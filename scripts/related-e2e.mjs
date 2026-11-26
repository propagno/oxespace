/**
 * OXE-434: deterministic PR E2E impact selector.
 *
 * Maps changed repository paths to a bounded set of Playwright smoke specs (playwright.config.ts)
 * and acceptance specs (playwright.acceptance.config.ts) so PRs catch selector, layout, shell,
 * settings, sidebar, and Thread regressions BEFORE merge while finishing in parallel with unit shards.
 *
 * Usage:
 *   node scripts/related-e2e.mjs --stdin --json            reads newline-separated changed paths from stdin
 *   node scripts/related-e2e.mjs [--base origin/main] --json
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MAX_SMOKE_SPECS = 15
export const MAX_ACCEPTANCE_SPECS = 4

/** Mirrors playwright.config.ts testIgnore so non-smoke specs are never passed to `npm run test:e2e`. */
const SMOKE_IGNORED = [
  /^e2e\/(visual|brand|perf|release|acceptance)\//,
  /^e2e\/(perf-benchmark|memory-footprint|perceived-perf|browser-preview-performance|perf-load|screenshots|packaged-linux|packaged-win)\.spec\.ts$/
]

export const DOMAIN_RULES = [
  {
    name: 'threads',
    when: /^(src\/components\/Threads\/|electron\/main\/services\/conversation\/)/,
    smoke: [
      'e2e/thread-view.spec.ts',
      'e2e/thread-project-navigation.spec.ts',
      'e2e/thread-sections.spec.ts',
      'e2e/thread-panel-column.spec.ts',
      'e2e/thread-approval-card.spec.ts'
    ],
    acceptance: ['e2e/acceptance/S3-conversations-survive-restart.spec.ts']
  },
  {
    name: 'settings',
    when: /^src\/components\/(Settings|MCP|Remote)\//,
    smoke: [
      'e2e/settings-tabs.spec.ts',
      'e2e/settings-desktop.spec.ts',
      'e2e/settings-tools.spec.ts',
      'e2e/settings-devices.spec.ts',
      'e2e/workspace-settings-design.spec.ts'
    ],
    acceptance: ['e2e/acceptance/oxe152-f6/brd23-settings.spec.ts']
  },
  {
    name: 'shell-sidebar',
    when: /^(src\/components\/(Sidebar|Navigation|Workbench|Attention|Usage|Workspace)\/|src\/App\.tsx$)/,
    smoke: [
      'e2e/smoke-hub.spec.ts',
      'e2e/navigation-redesign.spec.ts',
      'e2e/sidebar-scaling.spec.ts',
      'e2e/collapsed-rail.spec.ts',
      'e2e/project-shell.spec.ts',
      'e2e/needs-decision.spec.ts'
    ],
    acceptance: ['e2e/acceptance/oxe152-f6/brd09-shell.spec.ts']
  },
  {
    name: 'terminal-panes',
    when: /^(src\/components\/(Terminal|Panes|Grid)\/|electron\/main\/services\/terminal)/,
    smoke: [
      'e2e/workspace.spec.ts',
      'e2e/pane-layout-resize.spec.ts',
      'e2e/split-capacity.spec.ts',
      'e2e/terminal-focus-exit.spec.ts'
    ],
    acceptance: ['e2e/acceptance/oxe152-f6/brd14-terminal-pane.spec.ts']
  },
  {
    name: 'oxequery',
    when: /^(src\/components\/(OxeQuery|OxePod)\/|electron\/main\/services\/(oxequery|oxepod)\/|shared\/(types\/)?.*oxequery)/,
    smoke: [
      'e2e/oxequery.spec.ts',
      'e2e/oxequery-typing.spec.ts',
      'e2e/oxequery-completion-grid.spec.ts'
    ],
    acceptance: []
  },
  {
    name: 'approvals-close-guard',
    when: /^src\/components\/(Approvals|CloseGuard)\//,
    smoke: [
      'e2e/approvals.spec.ts',
      'e2e/approval-over-settings.spec.ts',
      'e2e/close-guard-canary.spec.ts'
    ],
    acceptance: []
  },
  {
    name: 'command-bar',
    when: /^src\/components\/(CommandBar|CommandMenu|SlashOverlay)\//,
    smoke: ['e2e/command-palette.spec.ts', 'e2e/palette-labels.spec.ts'],
    acceptance: ['e2e/acceptance/oxe152-f6/brd11-command-bar.spec.ts']
  },
  {
    name: 'git-changes-worktree',
    when: /^src\/components\/(Changes|Editor|Worktree|GitHub)\//,
    smoke: [
      'e2e/changes-panel.spec.ts',
      'e2e/worktree-current.spec.ts',
      'e2e/thread-worktree.spec.ts'
    ],
    acceptance: []
  },
  {
    name: 'delegation',
    when: /^src\/components\/Delegation\//,
    smoke: [
      'e2e/delegation-worktree-continuity.spec.ts',
      'e2e/cross-workspace-coordination.spec.ts'
    ],
    acceptance: []
  },
  {
    name: 'preview',
    when: /^src\/components\/(WebPreview|Preview)\//,
    smoke: ['e2e/preview.spec.ts', 'e2e/browser-preview-restart.spec.ts'],
    acceptance: []
  },
  {
    name: 'activity',
    when: /^src\/components\/Activity\//,
    smoke: ['e2e/activity-center.spec.ts'],
    acceptance: []
  },
  {
    name: 'onboarding',
    when: /^src\/components\/Onboarding\//,
    smoke: ['e2e/first-run.spec.ts'],
    acceptance: []
  },
  {
    name: 'ui-tokens-theme',
    when: /^(src\/(ui|styles|design)\/|src\/components\/Theme\/)/,
    smoke: [
      'e2e/smoke-hub.spec.ts',
      'e2e/button-affordance.spec.ts',
      'e2e/appearance-scale-density.spec.ts',
      'e2e/overlay-a11y.spec.ts'
    ],
    acceptance: []
  },
  {
    name: 'locales',
    when: /^shared\/locales\//,
    smoke: ['e2e/i18n.spec.ts', 'e2e/code-i18n.spec.ts', 'e2e/thread-i18n.spec.ts'],
    acceptance: []
  },
  {
    name: 'ipc-preload',
    when: /^electron\/(main\/ipc|preload)\//,
    smoke: ['e2e/smoke-hub.spec.ts', 'e2e/ipc-sender-guard.spec.ts', 'e2e/workspace.spec.ts'],
    acceptance: []
  },
  {
    name: 'db-storage',
    when: /^electron\/main\/db\//,
    smoke: ['e2e/storage-survives-quit.spec.ts', 'e2e/thread-sections-restart.spec.ts'],
    acceptance: []
  }
]

const FALLBACK_APP_PATH = /^(src|electron|shared)\//
const FALLBACK_SPECS = ['e2e/smoke-hub.spec.ts', 'e2e/workspace.spec.ts']
const DIRECT_E2E_SPEC = /^e2e\/.+\.spec\.ts$/
const ACCEPTANCE_SPEC = /^e2e\/acceptance\/.+\.spec\.ts$/

export function isSmokeSpec(path) {
  return DIRECT_E2E_SPEC.test(path) && !SMOKE_IGNORED.some(pattern => pattern.test(path))
}

/**
 * Computes bounded impacted smoke + acceptance specs for a list of repository-relative changed paths.
 * Verifies every returned spec exists under `root` so renamed/deleted files never break CI.
 */
export function planRelatedE2e(files, { root = process.cwd(), exists = existsSync } = {}) {
  const paths = [...new Set(files.map(file => String(file).replace(/\\/g, '/').trim()).filter(Boolean))]
  const directSmoke = new Set()
  const directAcceptance = new Set()
  const domainSmoke = new Set()
  const domainAcceptance = new Set()
  const reasons = []
  let touchesApp = false

  const keepExisting = spec => exists(join(root, spec))

  for (const file of paths) {
    if (ACCEPTANCE_SPEC.test(file) && keepExisting(file)) {
      directAcceptance.add(file)
      reasons.push(`changed acceptance spec: ${file}`)
      continue
    }
    if (isSmokeSpec(file) && keepExisting(file)) {
      directSmoke.add(file)
      reasons.push(`changed e2e spec: ${file}`)
      continue
    }
    if (FALLBACK_APP_PATH.test(file) && !/\.test\.tsx?$/.test(file)) {
      touchesApp = true
    }
    for (const rule of DOMAIN_RULES) {
      if (!rule.when.test(file)) continue
      if (!reasons.includes(`domain:${rule.name}`)) reasons.push(`domain:${rule.name}`)
      for (const spec of rule.smoke) if (keepExisting(spec)) domainSmoke.add(spec)
      for (const spec of rule.acceptance) if (keepExisting(spec)) domainAcceptance.add(spec)
    }
  }

  // Always prioritize directly edited specs before domain-inferred specs when applying caps.
  const smoke = [...directSmoke, ...[...domainSmoke].filter(spec => !directSmoke.has(spec))].slice(0, MAX_SMOKE_SPECS)
  const acceptance = [...directAcceptance, ...[...domainAcceptance].filter(spec => !directAcceptance.has(spec))].slice(0, MAX_ACCEPTANCE_SPECS)

  if (smoke.length === 0 && acceptance.length === 0 && touchesApp) {
    for (const spec of FALLBACK_SPECS) if (keepExisting(spec)) smoke.push(spec)
    reasons.push('fallback:app-smoke')
  }

  return { smoke, acceptance, reasons }
}

function readChangedFiles(argv) {
  if (argv.includes('--stdin')) {
    return readFileSync(0, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  }
  const baseAt = argv.indexOf('--base')
  const base = baseAt >= 0 ? argv[baseAt + 1] : 'origin/main'
  return execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
}

function main(argv) {
  const plan = planRelatedE2e(readChangedFiles(argv))
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(plan)}\n`)
    return 0
  }
  process.stdout.write(`Impacted smoke specs (${plan.smoke.length}): ${plan.smoke.join(', ') || 'none'}\n`)
  process.stdout.write(`Impacted acceptance specs (${plan.acceptance.length}): ${plan.acceptance.join(', ') || 'none'}\n`)
  return 0
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2))
}
