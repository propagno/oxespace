// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-209, PU-03·5, CA-1 and CA-2; brand-approved POLISH-03 #5,
// brand.md "28 only on the first run's hero").
// Written by the planner; the executor must not edit it. Runs after T31: BRD-12 (OXE-77) makes the title
// [data-ui=first-run-title] and creates src/design/targets/brd-12.json with its font-size (--fs-display) and font-family
// (--font-display) measures; this card adds the weight and the type rule.
// Today (main 4b7015c89) .heroTitle is calc(var(--fs-display) + var(--space-1)) (32, 34 comfortable), has no
// --stretch-display, and fixes letter-spacing and line-height, which leaves an orphan word.
// Contract:
// - The title keeps T31's hook: one [data-ui=first-run-title], an <h1>.
// - SOURCE-TEXT check (marked; jsdom applies no CSS module, the e2e spec pu-03-5 reads the computed style): the
//   FirstRun.module.css rules that set the title's size (a narrow-window override too) use font-size: var(--fs-display)
//   exactly (no calc) and no letter-spacing, and the title's rules give font-stretch
//   var(--stretch-display), font-weight var(--weight-bold), line-height var(--leading-tight), text-wrap: balance, and
//   no letter-spacing. --fs-display is the same in both densities (src/design/tokens/css.ts adds a pixel only up to lg).
// - brd-12.json gains BRD-12.title.font-weight (scene first-run, prop font-weight, token --weight-bold, both densities and
//   themes), enforced and in enforced.lock.json, beside T31's font-size measure.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FirstRun, type FirstRunProps } from '../../../src/components/Onboarding/FirstRun'
import { changeLanguage } from '../../../src/i18n'

const ROOT = process.cwd()
function props(): FirstRunProps {
  return { folder: null, agents: [{ provider: 'claude', status: 'missing' }], onOpenFolder: vi.fn(), onSignIn: vi.fn(), onCancelSignIn: vi.fn(),
    onNewConversation: vi.fn(), onOpenMode: vi.fn(), onNewWorkspace: vi.fn() }
}
/** The bodies of the FirstRun.module.css rules that set font-size from --fs-display (source text). */
function titleRules(): string[] {
  const css = readFileSync(join(ROOT, 'src/components/Onboarding/FirstRun.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  return [...css.matchAll(/[^{}]*\{([^{}]*)\}/g)].map(match => match[1]).filter(body => /font-size\s*:[^;]*--fs-display/.test(body))
}

beforeEach(async () => { await changeLanguage('pt-BR') })
afterEach(async () => { cleanup(); await changeLanguage('en') })

describe('OXE-209 PU-03·5 the first run\'s title at the display scale', () => {
  it('the title is the one h1 [data-ui=first-run-title]', () => {
    render(<FirstRun {...props()} />)
    const titles = screen.getByTestId('first-run').querySelectorAll('[data-ui="first-run-title"]')
    expect(titles).toHaveLength(1)
    expect(titles[0].tagName).toBe('H1')
  })

  it('its rule is --fs-display, --stretch-display, --weight-bold, --leading-tight and balance, with no letter-spacing (source text, marked)', () => {
    const rules = titleRules()
    expect(rules.length, 'a rule sets the title size').toBeGreaterThan(0)
    // Every rule that sizes the title (a narrow-window override included) is exactly --fs-display, with no tracking.
    for (const rule of rules) {
      expect(rule).toMatch(/font-size\s*:\s*var\(--fs-display\)\s*(;|$)/)
      expect(rule).not.toMatch(/letter-spacing/)
    }
    const body = rules.join(';')
    expect(body).toMatch(/font-stretch\s*:\s*var\(--stretch-display\)/)
    expect(body).toMatch(/font-weight\s*:\s*var\(--weight-bold\)/)
    expect(body).toMatch(/line-height\s*:\s*var\(--leading-tight\)/)
    expect(body).toMatch(/text-wrap\s*:\s*balance/)
    expect(body).not.toMatch(/letter-spacing/)
  })

  it('brd-12.json enforces the title weight beside its size', () => {
    const file = join(ROOT, 'src/design/targets/brd-12.json')
    expect(existsSync(file), 'brd-12.json (T31)').toBe(true)
    const doc = JSON.parse(readFileSync(file, 'utf8')) as { measures: Array<Record<string, unknown>> }
    const lock = (JSON.parse(readFileSync(join(ROOT, 'src/design/targets/enforced.lock.json'), 'utf8')) as { enforced: string[] }).enforced
    const weight = doc.measures.find(item => item.id === 'BRD-12.title.font-weight')
    expect(weight, 'BRD-12.title.font-weight').toBeDefined()
    expect(weight).toMatchObject({ scene: 'first-run', prop: 'font-weight', expect: { token: '--weight-bold' }, state: 'enforced' })
    expect([...(weight?.densities as string[] ?? [])].sort()).toEqual(['comfortable', 'compact'])
    expect([...(weight?.themes as string[] ?? [])].sort()).toEqual(['dark', 'light'])
    expect(lock).toContain('BRD-12.title.font-weight')
    const size = doc.measures.find(item => item.id === 'BRD-12.title.font-size')
    expect(size).toMatchObject({ expect: { token: '--fs-display' }, state: 'enforced' })
  })
})
