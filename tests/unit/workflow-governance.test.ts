// @vitest-environment node
// OXE-434: workflow governance & supply-chain guardrails for .github/workflows/ and .github/actions/.
// Prevents ghost/temporary workflows, unpinned actions, unsafe npm ci, missing timeouts/concurrency,
// masked brand-conformance failures, and silent release-gate omissions.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- plain ESM script without declaration file
import { DISPATCHABLE_WORKFLOWS } from '../../scripts/merge-train.mjs'
// @ts-expect-error -- plain ESM script without declaration file
import { VISUAL_WORKFLOW } from '../../scripts/pr-ready.mjs'
// @ts-expect-error -- plain ESM script without declaration file
import { CI_WORKFLOW, MAIN_JOBS } from '../../scripts/release.mjs'

const ROOT = process.cwd()
const WORKFLOWS_DIR = join(ROOT, '.github', 'workflows')
const ACTIONS_DIR = join(ROOT, '.github', 'actions')

// OXE-434 (Decision A4): exact 8 canonical workflows allowed in .github/workflows/.
const ALLOWED_WORKFLOWS = new Set([
  'android.yml',
  'ci.yml',
  'jira-sync.yml',
  'manual-ops.yml',
  'merge-train.yml',
  'nightly.yml',
  'release.yml',
  'visual.yml'
])

const EXPECTED_ACTIONS = [
  'setup-oxespace',
  'build-oxespace',
  'package-electron',
  'setup-android'
]

const FORBIDDEN_WORKFLOW_PATTERN = /(temporary|probe|bisect|poc|timing|shots|trace|remote[-_]verify|oxe[-_]?\d+)/i
const PINNED_ACTION_RE = /^[^@\s]+@[0-9a-f]{40}$/
const LOCAL_USES_RE = /^\.\/\.github\/(actions|workflows)\//

type Step = { name?: string; uses?: string; run?: string; shell?: string; 'continue-on-error'?: unknown }
type Job = { uses?: string; needs?: string | string[]; 'timeout-minutes'?: number; steps?: Step[] }
type WorkflowDoc = {
  name?: string
  on?: Record<string, unknown>
  permissions?: unknown
  concurrency?: { group?: string }
  jobs?: Record<string, Job>
}
type ActionDoc = {
  name?: string
  runs?: { using?: string; steps?: Step[] }
}

function listWorkflowFiles(): string[] {
  return readdirSync(WORKFLOWS_DIR).sort()
}

function listActionFiles(): string[] {
  if (!existsSync(ACTIONS_DIR)) return []
  return readdirSync(ACTIONS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(entry.name, 'action.yml'))
    .sort()
}

function loadWorkflow(file: string): WorkflowDoc {
  return load(readFileSync(join(WORKFLOWS_DIR, file), 'utf8')) as WorkflowDoc
}

function loadAction(relPath: string): ActionDoc {
  return load(readFileSync(join(ACTIONS_DIR, relPath), 'utf8')) as ActionDoc
}

function normalizeNeeds(needs: string | string[] | undefined): string[] {
  if (!needs) return []
  return Array.isArray(needs) ? needs : [needs]
}

function findUnprotectedNpmCi(script: string): string[] {
  const offenders: string[] = []
  for (const rawLine of script.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line || !/\bnpm\s+ci\b/.test(line)) continue
    if (!/--ignore-scripts\b/.test(line)) offenders.push(line)
  }
  return offenders
}

describe('OXE-434: GitHub Actions workflow & composite action governance', () => {
  it('allows only canonical allowlisted .yml workflows and blocks temporary/probe/remote-verify files', () => {
    const files = listWorkflowFiles()
    const unexpected = files.filter(file => !ALLOWED_WORKFLOWS.has(file))
    const missing = [...ALLOWED_WORKFLOWS].filter(file => !files.includes(file))
    const forbidden = files.filter(file => FORBIDDEN_WORKFLOW_PATTERN.test(file))
    const badExt = files.filter(file => !file.endsWith('.yml'))

    expect(unexpected, `Unexpected workflow file(s) outside allowlist: ${unexpected.join(', ')}`).toEqual([])
    expect(missing, `Missing allowlisted workflow file(s): ${missing.join(', ')}`).toEqual([])
    expect(forbidden, `Forbidden ad-hoc workflow name(s): ${forbidden.join(', ')}`).toEqual([])
    expect(badExt, `Workflow files must use .yml extension: ${badExt.join(', ')}`).toEqual([])

    // Verify the forbidden pattern catches historical ghost names
    for (const ghost of ['perf-bisect.yml', 'perf-probe.yml', 'oxe398-timing.yml', 'pty-rust-poc.yml', 'remote-verify.yml', 'fe-r12-skills-shots.yml', 'trace-docpreview.yml']) {
      expect(FORBIDDEN_WORKFLOW_PATTERN.test(ghost), ghost).toBe(true)
    }
  })

  it('ships all expected composite actions with explicit shells on every run step', () => {
    const actionFiles = listActionFiles()
    expect(actionFiles).toEqual(EXPECTED_ACTIONS.map(name => join(name, 'action.yml')).sort())

    const missingShell: string[] = []
    for (const rel of actionFiles) {
      const doc = loadAction(rel)
      expect(doc.runs?.using, `${rel} must be a composite action`).toBe('composite')
      const steps = doc.runs?.steps ?? []
      expect(steps.length, `${rel} must define steps`).toBeGreaterThan(0)
      for (const step of steps) {
        if (step.run && !step.shell) missingShell.push(`${rel} › ${step.name ?? '<unnamed>'}`)
      }
    }
    expect(missingShell, `Composite action run steps missing explicit shell: ${missingShell.join(', ')}`).toEqual([])
  })

  it('pins every external uses: reference to a 40-char commit SHA across workflows and composite actions', () => {
    const unpinned: string[] = []

    for (const file of listWorkflowFiles()) {
      const doc = loadWorkflow(file)
      for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
        if (job.uses && !LOCAL_USES_RE.test(job.uses) && !PINNED_ACTION_RE.test(job.uses)) {
          unpinned.push(`${file} › ${jobId}: ${job.uses}`)
        }
        for (const step of job.steps ?? []) {
          if (step.uses && !LOCAL_USES_RE.test(step.uses) && !PINNED_ACTION_RE.test(step.uses)) {
            unpinned.push(`${file} › ${jobId} › ${step.name ?? '<unnamed>'}: ${step.uses}`)
          }
        }
      }
    }

    for (const rel of listActionFiles()) {
      const doc = loadAction(rel)
      for (const step of doc.runs?.steps ?? []) {
        if (step.uses && !LOCAL_USES_RE.test(step.uses) && !PINNED_ACTION_RE.test(step.uses)) {
          unpinned.push(`.github/actions/${rel} › ${step.name ?? '<unnamed>'}: ${step.uses}`)
        }
      }
    }

    expect(unpinned, `Unpinned action reference(s): ${unpinned.join('; ')}`).toEqual([])
  })

  it('enforces permissions, concurrency, job timeouts, npm ci --ignore-scripts, and main-only push branches', () => {
    const violations: string[] = []

    for (const file of listWorkflowFiles()) {
      const doc = loadWorkflow(file)
      if (doc.permissions === undefined) violations.push(`${file}: missing top-level permissions`)
      if (!doc.concurrency?.group) violations.push(`${file}: missing top-level concurrency.group`)

      const push = doc.on?.push as { branches?: string[] } | undefined
      if (push?.branches) {
        for (const branch of push.branches) {
          if (branch !== 'main') violations.push(`${file}: push.branches allows non-main branch '${branch}'`)
        }
      }

      for (const [jobId, job] of Object.entries(doc.jobs ?? {})) {
        if (!job.uses && (typeof job['timeout-minutes'] !== 'number' || job['timeout-minutes'] <= 0)) {
          violations.push(`${file} › ${jobId}: missing positive timeout-minutes`)
        }
        for (const step of job.steps ?? []) {
          if (!step.run) continue
          for (const bad of findUnprotectedNpmCi(step.run)) {
            violations.push(`${file} › ${jobId} › ${step.name ?? '<unnamed>'}: npm ci without --ignore-scripts (${bad})`)
          }
        }
      }
    }

    for (const rel of listActionFiles()) {
      const doc = loadAction(rel)
      for (const step of doc.runs?.steps ?? []) {
        if (!step.run) continue
        for (const bad of findUnprotectedNpmCi(step.run)) {
          violations.push(`.github/actions/${rel} › ${step.name ?? '<unnamed>'}: npm ci without --ignore-scripts (${bad})`)
        }
      }
    }

    expect(violations, `Workflow hygiene violation(s):\n${violations.join('\n')}`).toEqual([])
  })

  it('guards against v1.6.0/v1.6.1 CI regressions and enforces release/security invariants (SRE-04, SECURITY #231)', () => {
    const ci = loadWorkflow('ci.yml')
    const brandSteps = Object.entries(ci.jobs ?? {}).flatMap(([jobId, job]) =>
      (job.steps ?? [])
        .filter(step => Boolean(step.run?.includes('playwright.brand.config.ts')))
        .map(step => ({ jobId, step }))
    )
    expect(brandSteps.length).toBeGreaterThan(0)
    for (const { jobId, step } of brandSteps) {
      expect(step['continue-on-error'], `${jobId} › ${step.name} must not mask failures with continue-on-error`).not.toBe(true)
    }

    // ci.yml is purely read-only CI (required check "CI result", no release publishing or tag trigger).
    expect((ci.jobs?.['ci-result'] as { name?: string })?.name).toBe('CI result')
    expect(ci.jobs?.release, 'release publishing must live in release.yml, not ci.yml').toBeUndefined()
    expect((ci.on?.push as { tags?: string[] } | undefined)?.tags, 'tag triggers belong exclusively to release.yml').toBeUndefined()

    // release.yml preserves SRE-04, SECURITY #231 (unsigned build has zero secrets), and acceptance-release gating.
    const releaseRaw = readFileSync(join(WORKFLOWS_DIR, 'release.yml'), 'utf8')
    const release = loadWorkflow('release.yml')
    expect(release.jobs?.verify?.uses).toBe('./.github/workflows/ci.yml')
    expect(normalizeNeeds(release.jobs?.['package-desktop']?.needs)).toEqual(expect.arrayContaining(['verify', 'acceptance-release']))
    expect((release.jobs?.['publish-desktop'] as { environment?: { name?: string }; 'runs-on'?: string })?.environment?.name).toBe('release')
    expect((release.jobs?.['publish-desktop'] as { 'runs-on'?: string })?.['runs-on']).toBe('ubuntu-24.04')
    expect((release.jobs?.['sign-android'] as { environment?: string })?.environment).toBe('android-release')
    expect((release.jobs?.['android-build'] as { permissions?: Record<string, string> })?.permissions).toEqual({ contents: 'read' })
    const androidBuildSection = releaseRaw.slice(releaseRaw.indexOf('\n  android-build:'), releaseRaw.indexOf('\n  package-desktop:'))
    expect(androidBuildSection, 'android-build must never reference secrets (SECURITY #231)').not.toContain('secrets.')

    // nightly.yml calls ci.yml natively via workflow_call (no idle watcher runner).
    const nightly = loadWorkflow('nightly.yml')
    expect(nightly.jobs?.['packaged-smoke']?.uses).toBe('./.github/workflows/ci.yml')

    // visual.yml keeps compare read-only on PRs (Linux + Windows automatic per Decision A5).
    const visual = loadWorkflow('visual.yml')
    expect((visual.jobs?.compare as { permissions?: Record<string, string> })?.permissions).toEqual({ contents: 'read' })

    // manual-ops.yml stays within GitHub's 10-input workflow_dispatch limit.
    const manualOps = loadWorkflow('manual-ops.yml')
    const manualInputs = (manualOps.on?.workflow_dispatch as { inputs?: Record<string, unknown> } | undefined)?.inputs ?? {}
    expect(Object.keys(manualInputs).length).toBeLessThanOrEqual(10)

    const codeowners = readFileSync(join(ROOT, '.github', 'CODEOWNERS'), 'utf8')
    expect(codeowners).toContain('/.github/workflows/')
    expect(codeowners).toContain('/.github/actions/')

    const vitestConfig = readFileSync(join(ROOT, 'vitest.config.ts'), 'utf8')
    expect(vitestConfig).toMatch(/retry:\s*process\.env\.CI\s*\?\s*1\s*:\s*0/)
  })

  it('keeps ci.yml slimmed on composite actions with workflow_call, fast-gate, single build/OS, e2e-impacted, and 5W/4L shards', () => {
    const ci = loadWorkflow('ci.yml')
    expect(ci.on?.workflow_call, 'ci.yml must expose workflow_call for release.yml and nightly.yml').toBeDefined()

    const usesSet = new Set(
      Object.values(ci.jobs ?? {}).flatMap(job => (job.steps ?? []).map(step => step.uses).filter(Boolean))
    )
    expect(usesSet.has('./.github/actions/setup-oxespace')).toBe(true)
    expect(usesSet.has('./.github/actions/build-oxespace')).toBe(true)
    expect(usesSet.has('./.github/actions/package-electron')).toBe(true)

    expect(ci.jobs?.build, 'ci.yml must have a dedicated build job (once per OS)').toBeDefined()
    expect(ci.jobs?.['brand-conformance'], 'ci.yml must have a dedicated brand-conformance job').toBeDefined()
    expect(ci.jobs?.['e2e-impacted'], 'ci.yml must have a PR e2e-impacted job').toBeDefined()

    const unitMatrix = (ci.jobs?.['unit-shard'] as { strategy?: { matrix?: { include?: Array<{ label: string; total: number }> } } })?.strategy?.matrix?.include ?? []
    expect(unitMatrix.filter(entry => entry.label === 'windows-x64')).toHaveLength(5)
    expect(unitMatrix.filter(entry => entry.label === 'linux-x64')).toHaveLength(4)

    const e2eShards = (ci.jobs?.e2e as { strategy?: { matrix?: { shard?: number[] } } })?.strategy?.matrix?.shard ?? []
    expect(e2eShards).toEqual([1, 2, 3, 4])

    // Shard 1 runs upgrade-rehearsal.native.test.ts (needs tag v1.3.3); numeric `&& 0 || 1` is falsy in GHA expressions.
    const e2eCheckout = (ci.jobs?.e2e?.steps?.[0] as { with?: { 'fetch-depth'?: unknown; 'fetch-tags'?: unknown } } | undefined)?.with
    expect(String(e2eCheckout?.['fetch-depth'] ?? '')).toContain("'0'")
    expect(String(e2eCheckout?.['fetch-depth'] ?? '')).not.toMatch(/&&\s*0\s*\|\|/)
    expect(String(e2eCheckout?.['fetch-tags'] ?? '')).toContain('matrix.shard == 1')
  })

  it('keeps workflow filenames referenced by repo scripts in sync with .github/workflows/', () => {
    const referenced = new Set<string>([
      ...(DISPATCHABLE_WORKFLOWS as string[]),
      VISUAL_WORKFLOW as string,
      (CI_WORKFLOW as string).split('/').pop() ?? '',
      ...(MAIN_JOBS as Array<{ file: string }>).map(entry => entry.file)
    ])

    const missing = [...referenced].filter(file => !file || !existsSync(join(WORKFLOWS_DIR, file)))
    expect(missing, `Script(s) reference missing workflow(s): ${missing.join(', ')}`).toEqual([])
  })
})
