// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-244, PM-02·2, CA-1 and CA-2; brand-approved POLISH-02 #2,
// "--attn is only for Precisa de você"). Written by the planner; the executor must not edit it. Runs after T27 (BRD-09:
// each mode tab carries its own needs-you count as text inside the tab, data-testid attention-badge kept).
// Today (main 4b7015c89) .badge is a 14×14 box at top -4px that clips a pixel above the bar, runs 7px over the neighbour
// tab past 1080px, and is painted with --intent-warning-* instead of --attn-*.
// Contract:
// - The count ([data-testid=attention-badge]) is inside its own tab (role tab), never a sibling over the next one.
// - SOURCE-TEXT check (marked; jsdom paints nothing, the e2e spec pm-02-2 measures the rectangle and the colour):
//   ModeSwitch.module.css styles the badge inline (no position: absolute, no negative top), with gap var(--space-1)
//   from the label, background var(--attn-bg), border colour var(--attn-border) and text var(--attn-fg), and names no
//   --intent-warning token.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ModeSwitch } from '../../../src/components/Navigation/ModeSwitch'
import { useActivityStore } from '../../../src/store/activity.store'
import { changeLanguage } from '../../../src/i18n'

const ROOT = process.cwd()
const css = (): string => readFileSync(join(ROOT, 'src/components/Navigation/ModeSwitch.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
function waiting(code: number, thread: number): void {
  const entries = (count: number, prefix: string) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`${prefix}-${index}`, 'needs-you' as const]))
  useActivityStore.setState({ live: { code: entries(code, 'pane'), thread: entries(thread, 'thread') } } as never)
}

beforeEach(async () => { await changeLanguage('en') })
afterEach(() => { cleanup(); useActivityStore.setState({ live: { code: {}, thread: {} } } as never) })

describe('OXE-244 PM-02·2 the mode badge sits inline, in the needs-you colours', () => {
  it('each count is inside its own tab', () => {
    waiting(2, 1)
    render(<ModeSwitch mode="data" onSelect={() => {}} />)
    const badges = screen.getAllByTestId('attention-badge')
    expect(badges).toHaveLength(2)
    for (const badge of badges) {
      const tab = badge.closest('[role="tab"]')
      expect(tab, 'the badge is inside a tab').not.toBeNull()
      expect(tab?.getAttribute('data-app-mode')).not.toBe('data')
    }
  })

  it('the badge rule is inline and uses --attn-bg, --attn-border and --attn-fg (source text, marked)', () => {
    const rules = [...css().matchAll(/([^{}]*badge[^{}]*)\{([^{}]*)\}/gi)].map(match => match[2])
    expect(rules.length, 'a badge rule').toBeGreaterThan(0)
    const body = rules.join(';')
    expect(body).toMatch(/background(-color)?\s*:\s*var\(--attn-bg\)/)
    expect(body).toMatch(/border(-color)?\s*:[^;]*var\(--attn-border\)/)
    expect(body).toMatch(/(^|[;\s])color\s*:\s*var\(--attn-fg\)/)
    expect(body).not.toMatch(/position\s*:\s*absolute/)
    expect(body).not.toMatch(/top\s*:\s*-/)
    expect(css()).not.toMatch(/--intent-warning/)
    const holders = [...css().matchAll(/[^{}]*\{([^{}]*)\}/g)].map(match => match[1]).filter(item => /gap\s*:\s*var\(--space-1\)/.test(item))
    expect(holders.length, 'the tab spaces its count with --space-1').toBeGreaterThan(0)
  })
})
