import { describe, expect, it } from 'vitest'
import { planRelatedTests } from '../scripts/related-tests.mjs'

// pr:ready's selector (agents maturity M4): vitest --changed follows imports; this adds what it can't see.
describe('the related-tests plan', () => {
  it('runs the whole suite when a change touches every test', () => {
    for (const file of ['package.json', 'package-lock.json', 'vitest.config.ts', 'tsconfig.json', 'tests/setup.ts']) {
      expect(planRelatedTests(['src/App.tsx', file])).toMatchObject({ all: true })
    }
  })

  it('lets vitest follow the imports of a code change, and adds design-lint for a renderer component', () => {
    expect(planRelatedTests(['electron/main/services/terminal.service.ts'])).toEqual({ all: false, changed: true, extra: [], reasons: [] })
    const plan = planRelatedTests(['src/components/Settings/DevicesSettings.tsx'])
    expect(plan).toMatchObject({ all: false, changed: true })
    expect(plan.extra).toEqual(['tests/design-lint.test.ts'])
  })

  it('adds the gate tests that read changed files from disk', () => {
    expect(planRelatedTests(['src/components/Settings/DevicesSettings.module.css']).extra)
      .toEqual(['tests/design-lint-target-size.test.ts', 'tests/design-lint.test.ts'])
    expect(planRelatedTests(['shared/locales/pt-BR/settings.json']).extra)
      .toEqual(['tests/code-i18n.test.ts', 'tests/i18n-catalog.test.ts', 'tests/main-i18n.test.ts'])
    expect(planRelatedTests(['shared/remote/protocol.ts']).extra).toContain('tests/android-generated.test.ts')
    expect(planRelatedTests(['src/design/tokens/semantic.ts']).extra)
      .toEqual(['tests/android-generated.test.ts', 'tests/design-lint.test.ts', 'tests/design-tokens.test.ts'])
  })

  it('runs a changed test file itself, but not a frozen acceptance test that is red until its item lands', () => {
    expect(planRelatedTests(['tests/devices-firewall.test.tsx']).extra).toEqual(['tests/devices-firewall.test.tsx'])
    expect(planRelatedTests(['tests/acceptance/f2/a7-settings-rows.test.ts']).extra).toEqual([])
  })

  it('needs no tests for docs alone, and reads Windows paths', () => {
    expect(planRelatedTests(['docs/roadmap-1.5/ccr-a7-settings-rows.md', '.github/workflows/ci.yml']))
      .toEqual({ all: false, changed: false, extra: [], reasons: [] })
    expect(planRelatedTests(['shared\\locales\\en\\main.json']).extra).toContain('tests/i18n-catalog.test.ts')
  })
})
