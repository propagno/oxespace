// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-210, PU-03·6, CA-1; brand-approved POLISH-03 #6, WCAG 1.3.1
// and 2.4.6). Written by the planner; the executor must not edit it. Runs after T31 (BRD-12's three steps).
// Today (main 4b7015c89) FirstRun goes from its <h1> straight to <h3> step titles and has no <h2>.
// Contract: inside [data-testid=first-run] the headings, in document order, start with the one <h1> (the title), every
// step title is an <h2>, and no heading is more than one level below the heading before it (no skipped level, no <h3>
// before an <h2>). The visual size of the step titles is kept (CA-2: the brand's side-by-side, marca/fidelidade).
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FirstRun, type FirstRunProps } from '../../../src/components/Onboarding/FirstRun'
import { changeLanguage } from '../../../src/i18n'

function props(overrides: Partial<FirstRunProps> = {}): FirstRunProps {
  return { folder: null, agents: [{ provider: 'claude', status: 'missing' }, { provider: 'codex', status: 'signed-out' }], onOpenFolder: vi.fn(), onSignIn: vi.fn(), onCancelSignIn: vi.fn(),
    onNewConversation: vi.fn(), onOpenMode: vi.fn(), onNewWorkspace: vi.fn(), ...overrides }
}
const levels = (): number[] => [...screen.getByTestId('first-run').querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, [role="heading"]')]
  .map(el => Number(el.getAttribute('aria-level') ?? el.tagName.slice(1)))
const stepHeadings = (): HTMLElement[] => {
  const root = screen.getByTestId('first-run')
  const branded = [...root.querySelectorAll<HTMLElement>('[data-ui="first-run-step"]')]
  const steps = branded.length ? branded : [...root.querySelectorAll<HTMLElement>('ol > li')]
  return steps.map(step => step.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6')).filter((el): el is HTMLElement => el !== null)
}

beforeEach(async () => { await changeLanguage('pt-BR') })
afterEach(async () => { cleanup(); await changeLanguage('en') })

describe('OXE-210 PU-03·6 the first run\'s headings are in order', () => {
  it.each([
    ['nothing chosen', {}],
    ['folder chosen and an agent ready', { folder: '/repo/demo', agents: [{ provider: 'claude' as const, status: 'ready' as const }] }]
  ])('%s: one h1, then h2 step titles, no skipped level', (_name, overrides) => {
    render(<FirstRun {...props(overrides)} />)
    const all = levels()
    expect(all[0], 'the title is the first heading').toBe(1)
    expect(all.filter(level => level === 1), 'one h1').toHaveLength(1)
    for (let index = 1; index < all.length; index++) expect(all[index], `heading ${index + 1} skips no level`).toBeLessThanOrEqual(all[index - 1] + 1)
    const titles = stepHeadings()
    expect(titles.length, 'every step has a title').toBeGreaterThanOrEqual(3)
    for (const title of titles) expect(title.tagName, `"${title.textContent}" is an h2`).toBe('H2')
  })
})
