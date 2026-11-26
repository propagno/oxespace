// @vitest-environment node
// OXE-434: verifies the PR E2E impact selector (scripts/related-e2e.mjs).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- plain ESM script without declaration file
import { DOMAIN_RULES, MAX_ACCEPTANCE_SPECS, MAX_SMOKE_SPECS, isSmokeSpec, planRelatedE2e } from '../../scripts/related-e2e.mjs'

const ROOT = process.cwd()

describe('OXE-434: related-e2e PR impact selector', () => {
  it('references only real spec files that exist on disk', () => {
    const missing: string[] = []
    for (const rule of DOMAIN_RULES as Array<{ name: string; smoke: string[]; acceptance: string[] }>) {
      for (const spec of [...rule.smoke, ...rule.acceptance]) {
        if (!existsSync(join(ROOT, spec))) missing.push(`${rule.name}: ${spec}`)
      }
    }
    expect(missing, `Missing spec(s) referenced by DOMAIN_RULES: ${missing.join(', ')}`).toEqual([])
  })

  it('skips E2E for docs, unit tests, and workflow-only PRs', () => {
    const plan = planRelatedE2e([
      'docs/ci-cd.md',
      'tests/unit/workflow-governance.test.ts',
      '.github/workflows/ci.yml',
      'scripts/merge-train.mjs'
    ])
    expect(plan.smoke).toEqual([])
    expect(plan.acceptance).toEqual([])
  })

  it('maps UI/domain edits to targeted smoke and acceptance specs', () => {
    const plan = planRelatedE2e([
      'src/components/Settings/SettingsModal.tsx',
      'src/components/Threads/ThreadView.tsx'
    ])
    expect(plan.smoke).toContain('e2e/settings-tabs.spec.ts')
    expect(plan.smoke).toContain('e2e/thread-view.spec.ts')
    expect(plan.acceptance).toContain('e2e/acceptance/oxe152-f6/brd23-settings.spec.ts')
    expect(plan.acceptance).toContain('e2e/acceptance/S3-conversations-survive-restart.spec.ts')
    expect(plan.smoke.length).toBeLessThanOrEqual(MAX_SMOKE_SPECS)
    expect(plan.acceptance.length).toBeLessThanOrEqual(MAX_ACCEPTANCE_SPECS)
  })

  it('includes directly edited smoke and acceptance specs while excluding non-smoke specs', () => {
    expect(isSmokeSpec('e2e/smoke-hub.spec.ts')).toBe(true)
    expect(isSmokeSpec('e2e/visual/anchor-surfaces.spec.ts')).toBe(false)
    expect(isSmokeSpec('e2e/brand/brand-conformance.spec.ts')).toBe(false)
    expect(isSmokeSpec('e2e/perf/pty-rust-quit.spec.ts')).toBe(false)
    expect(isSmokeSpec('e2e/acceptance/S3-conversations-survive-restart.spec.ts')).toBe(false)

    const plan = planRelatedE2e([
      'e2e/toasts.spec.ts',
      'e2e/acceptance/F18-243-approvals-modal.spec.ts',
      'e2e/visual/anchor-surfaces.spec.ts'
    ])
    expect(plan.smoke).toEqual(['e2e/toasts.spec.ts'])
    expect(plan.acceptance).toEqual(['e2e/acceptance/F18-243-approvals-modal.spec.ts'])
  })

  it('falls back to core app smoke when an unmapped src/ or electron/ file changes', () => {
    const plan = planRelatedE2e(['electron/main/updater.ts'])
    expect(plan.smoke).toEqual(['e2e/smoke-hub.spec.ts', 'e2e/workspace.spec.ts'])
    expect(plan.acceptance).toEqual([])
  })

  it('caps smoke and acceptance specs even on broad multi-domain PRs', () => {
    const plan = planRelatedE2e([
      'src/App.tsx',
      'src/components/Threads/a.tsx',
      'src/components/Settings/b.tsx',
      'src/components/Terminal/c.tsx',
      'src/components/OxeQuery/d.tsx',
      'src/components/Approvals/e.tsx',
      'src/components/CommandBar/f.tsx',
      'src/components/Changes/g.tsx',
      'src/ui/Button.tsx',
      'shared/locales/en/common.json'
    ])
    expect(plan.smoke.length).toBeLessThanOrEqual(MAX_SMOKE_SPECS)
    expect(plan.acceptance.length).toBeLessThanOrEqual(MAX_ACCEPTANCE_SPECS)
  })
})
