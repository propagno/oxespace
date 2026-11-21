// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-206, PU-03·1, CA-1 and CA-2; brand-approved POLISH-03 #1).
// Written by the planner; the executor must not edit it. Runs after T31 (BRD-12 rebuilds the first run; this keeps its
// structure: the steps are its [data-ui=first-run-step] <li>s).
// Today (main 4b7015c89) no step says it is the current one, and each agent's state is a bare .agentDot span that forced
// colours erase, leaving a hole before "Claude Code" and "Codex".
// Contract:
// - The current step's <li> has aria-current="step"; no other step has aria-current.
// - Each agent row shows the src/ui StatusSignal ([data-ui=status-signal], role img, a non-empty accessible name): ready is
//   state "done", signing in is "working", any other status is neither of those; no element with an agentDot class.
// - SOURCE-TEXT check (marked; forced colours cannot be computed in jsdom, the e2e spec pu-03-1 runs them in the app):
//   src/styles/forced-colors.css or FirstRun.module.css has a forced-colors rule for [aria-current="step"] with a 2px
//   outline in Highlight.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FirstRun, type FirstRunProps } from '../../../src/components/Onboarding/FirstRun'
import { changeLanguage } from '../../../src/i18n'

const ROOT = process.cwd()
function props(overrides: Partial<FirstRunProps> = {}): FirstRunProps {
  return { folder: null, agents: [{ provider: 'claude', status: 'ready' }, { provider: 'codex', status: 'signing-in' }], onOpenFolder: vi.fn(), onSignIn: vi.fn(), onCancelSignIn: vi.fn(),
    onNewConversation: vi.fn(), onOpenMode: vi.fn(), onNewWorkspace: vi.fn(), ...overrides }
}
/** BRD-12's steps once T31 lands ([data-ui=first-run-step]); the list items before it. */
const steps = (): HTMLElement[] => {
  const root = screen.getByTestId('first-run')
  const branded = [...root.querySelectorAll<HTMLElement>('[data-ui="first-run-step"]')]
  return branded.length ? branded : [...root.querySelectorAll<HTMLElement>('ol > li')]
}

/** The bodies of the at-rule blocks whose prelude matches, brace-matched (source text). */
function atBlocks(css: string, prelude: RegExp): string[] {
  const out: string[] = []
  for (const match of css.matchAll(new RegExp(`${prelude.source}\\s*\\{`, 'g'))) {
    let depth = 1
    let index = (match.index ?? 0) + match[0].length
    const start = index
    while (index < css.length && depth > 0) { if (css[index] === '{') depth++; else if (css[index] === '}') depth--; index++ }
    out.push(css.slice(start, index - 1))
  }
  return out
}

beforeEach(async () => { await changeLanguage('pt-BR') })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-206 PU-03·1 the first run in forced colours', () => {
  it('marks only the current step with aria-current="step", and it follows the progress', () => {
    const view = render(<FirstRun {...props({ agents: [{ provider: 'claude', status: 'missing' }] })} />)
    expect(steps().length).toBeGreaterThanOrEqual(3)
    expect(steps().map(step => step.getAttribute('aria-current'))).toEqual(['step', ...steps().slice(1).map(() => null)])
    view.unmount()
    render(<FirstRun {...props({ folder: '/repo/demo', agents: [{ provider: 'claude', status: 'missing' }] })} />)
    expect(steps().map(step => step.getAttribute('aria-current'))).toEqual([null, 'step', ...steps().slice(2).map(() => null)])
  })

  it('shows each agent\'s state as a StatusSignal with a name: ready is done, signing in is working', () => {
    render(<FirstRun {...props({ agents: [{ provider: 'claude', status: 'ready' }, { provider: 'codex', status: 'signing-in' }] })} />)
    const signals = [...screen.getByTestId('first-run').querySelectorAll<HTMLElement>('[data-ui="status-signal"]')]
    expect(signals.map(signal => signal.getAttribute('data-state'))).toEqual(['done', 'working'])
    for (const signal of signals) {
      expect(signal).toHaveAttribute('role', 'img')
      expect((signal.getAttribute('aria-label') ?? '').trim().length, 'the signal has a name').toBeGreaterThan(0)
    }
    expect(screen.getByTestId('first-run').querySelectorAll('[class*="agentDot"]'), 'no bare dot').toHaveLength(0)
  })

  it('a signed-out or missing agent has a signal that is neither done nor working', () => {
    render(<FirstRun {...props({ agents: [{ provider: 'claude', status: 'missing' }, { provider: 'codex', status: 'signed-out' }] })} />)
    const signals = [...screen.getByTestId('first-run').querySelectorAll<HTMLElement>('[data-ui="status-signal"]')]
    expect(signals).toHaveLength(2)
    for (const signal of signals) expect(['done', 'working']).not.toContain(signal.getAttribute('data-state'))
  })

  it('has a forced-colors rule for the current step: a 2px Highlight outline (source text, marked)', () => {
    const sources = ['src/styles/forced-colors.css', 'src/components/Onboarding/FirstRun.module.css']
      .map(file => join(ROOT, file)).filter(existsSync).map(file => readFileSync(file, 'utf8'))
    const blocks = sources.flatMap(css => atBlocks(css, /@media\s*\(forced-colors:\s*active\)/))
    const rule = blocks.flatMap(block => [...block.matchAll(/([^{}]*aria-current=["']?step["']?[^{}]*)\{([^}]*)\}/g)].map(match => match[2]))
    expect(rule.length, 'a forced-colors rule for [aria-current="step"]').toBeGreaterThan(0)
    expect(rule.join(';')).toMatch(/outline:\s*2px\s+solid\s+Highlight/i)
  })
})
