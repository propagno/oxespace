// Frozen acceptance test for 1.5.2 Polimento 2 (Jira OXE-271, PX-06·12, CA-1 to CA-3; A13–A15). Written by the planner;
// the executor must not edit it. The delegation dialogs on main f65fa5374: DelegatedWorkDialog.css capitalizes the task
// line (text-transform: capitalize over translated text), DelegationCreateDialog.css gives its fields and strategy
// labels min-height: 36px, its section heading font-weight: 650 and its focus ring var(--accent); DelegatedWorkDialog.tsx
// keeps English defaultValue fallbacks (`Blocked: …`, `Waits for: …`, task.state) although code:delegated.* exists.
// Contract: no capitalize in either file; .delegation-section-heading h3 uses var(--weight-semibold); the form fields
// (input, textarea, select) and .delegation-strategies label use var(--control-lg), never 36px; the fields' focus-visible
// outline is 2px solid var(--focus-ring); every delegated.* line comes from the catalog, with no defaultValue in the TSX.
// tests/acceptance/f2/r13-work-into-delegation.test.tsx (English) stays green: en/code.json has the same words.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { DelegatedWorkDialog } from '../../../src/components/Delegation/DelegatedWorkDialog'
import { changeLanguage } from '../../../src/i18n'

const ROOT = process.cwd()
const source = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const WORK_CSS = 'src/components/Delegation/DelegatedWorkDialog.css'
const CREATE_CSS = 'src/components/Delegation/DelegationCreateDialog.css'
/** Rules of a stylesheet: selector and body, comments dropped. */
const rules = (css: string): Array<{ selector: string; body: string }> => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1].trim(), body: m[2] }))
const decl = (body: string, property: string): string | undefined => body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`))?.[1].trim()

type Dependency = { id: string; objective: string; state: string }
const task = (id: string, objective: string, dependencies: Dependency[], extra: Record<string, unknown> = {}) => ({
  id, workspaceId: 'ws-1', objective, branch: `oxe/${id}`, state: 'accepted', agentProfileId: 'claude', surface: 'terminal',
  updatedAt: Date.UTC(2026, 9, 14), path: '/wt', baseSha: 'abc', cwd: '/repo', dependencies, ...extra
})

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-271 · PX-06·12 the delegation dialogs on the brand scale, in pt-BR', () => {
  test('[css] delegation dialogs omit text-transform capitalize, use --weight-semibold and size inputs with --control-lg', () => {
    for (const file of [WORK_CSS, CREATE_CSS]) expect(source(file), `${file} has no capitalize`).not.toMatch(/text-transform\s*:\s*capitalize/)
    const create = rules(source(CREATE_CSS))
    const heading = create.filter(rule => /\.delegation-section-heading\s+h3$/.test(rule.selector))
    expect(heading.length).toBeGreaterThan(0)
    for (const rule of heading) expect(decl(rule.body, 'font-weight'), rule.selector).toBe('var(--weight-semibold)')
    const fields = create.filter(rule => /\binput\b/.test(rule.selector) && /\btextarea\b/.test(rule.selector) && /\bselect\b/.test(rule.selector) && !/:focus|::placeholder/.test(rule.selector))
    expect(fields.length, 'the form fields rule').toBeGreaterThan(0)
    for (const rule of fields) {
      expect(decl(rule.body, 'min-height'), `${rule.selector} min-height`).toBe('var(--control-lg)')
      const height = decl(rule.body, 'height')
      if (height !== undefined) expect(height, `${rule.selector} height`).toBe('var(--control-lg)')
    }
    const strategies = create.filter(rule => /\.delegation-strategies\s+label$/.test(rule.selector))
    expect(strategies.length).toBeGreaterThan(0)
    for (const rule of strategies) expect(decl(rule.body, 'min-height'), rule.selector).toBe('var(--control-lg)')
    expect(source(CREATE_CSS), 'no 36px control height left').not.toMatch(/(?:min-)?height\s*:\s*36px/)
  })

  test('[css] DelegationCreateDialog focus-visible outline is 2 px var(--focus-ring)', () => {
    const focus = rules(source(CREATE_CSS)).filter(rule => /:focus-visible/.test(rule.selector) && /\b(?:input|textarea|select)\b/.test(rule.selector))
    expect(focus.length, 'the fields focus-visible rule').toBeGreaterThan(0)
    for (const rule of focus) expect(decl(rule.body, 'outline'), rule.selector).toBe('2px solid var(--focus-ring)')
  })

  test('in pt-BR DelegatedWorkDialog renders states and dependency lines from code:delegated.* with no English fallbacks', async () => {
    const tsx = source('src/components/Delegation/DelegatedWorkDialog.tsx')
    expect(tsx, 'no defaultValue on a delegated.* key').not.toMatch(/t\(\s*[`'"]delegated\.[^)]*defaultValue/)
    expect(tsx).not.toMatch(/Blocked: |Waits for: /)
    await changeLanguage('pt-BR')
    const tasks = [
      task('d-1', 'Build the API', []),
      task('d-2', 'Ship the client', [{ id: 'd-1', objective: 'Build the API', state: 'failed' }]),
      task('d-3', 'Write the docs', [{ id: 'd-1', objective: 'Build the API', state: 'accepted' }]),
      task('d-4', 'Release', [{ id: 'd-1', objective: 'Build the API', state: 'accepted' }, { id: 'd-3', objective: 'Write the docs', state: 'review' }], { state: 'review' })
    ]
    Object.assign(window, { oxe: { delegation: {
      status: vi.fn(async () => ({ enabled: true, tasks })), onChanged: vi.fn(() => () => undefined),
      control: vi.fn(async () => undefined), adopt: vi.fn(async () => undefined)
    } } })
    render(<DelegatedWorkDialog workspaces={[{ id: 'ws-1', name: 'repo' } as never]} workspaceId="ws-1" onClose={() => undefined} onOpen={async () => true} />)
    expect(await screen.findByText('Bloqueada: Build the API falhou')).toBeInTheDocument()
    expect(screen.getByText('Aguarda: Build the API')).toBeInTheDocument()
    expect(screen.getByText('Aguarda: Build the API e mais 1')).toBeInTheDocument()
    expect(screen.getAllByText('aceita').length).toBeGreaterThan(0)
    expect(screen.getAllByText('em revisão').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/Blocked: |Waits for: |\baccepted\b|\breview\b/)
  })
})
