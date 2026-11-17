// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-245, PM-02·3, CA-1 and CA-2; brand-approved POLISH-02 #3,
// "the frame scales with the density"). Written by the planner; the executor must not edit it. Runs after T27 (BRD-09
// edits the same TitleBar.module.css).
// Today (main 4b7015c89) TitleBar.module.css .bar fixes min-height and height at 36px, so the comfortable density
// (--bar-lg 40) is ignored, and .trailing has overflow: hidden, which clips 3px of the bell's count.
// Contract (SOURCE-TEXT checks, marked: jsdom lays nothing out; the e2e spec pm-02-3 measures 40px and the whole count in
// the built app; the header itself is App.tsx's, which this card does not touch, so it gets no data-ui measure):
// - .bar: height var(--bar-lg), and no height or min-height in px.
// - .trailing: no overflow: hidden, and padding-right var(--space-1).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src/components/Navigation/TitleBar.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
/** The declarations of the top-level rules whose selector is exactly `.name` (source text). */
const body = (name: string): string => [...css.matchAll(/(^|\})\s*([^{}@]+)\{([^{}]*)\}/g)].filter(match => match[2].trim() === `.${name}`).map(match => match[3]).join(';')

describe('OXE-245 PM-02·3 the title bar follows the density and never clips the bell', () => {
  it('.bar is --bar-lg tall, with no fixed pixel height', () => {
    const bar = body('bar')
    expect(bar.length, 'the .bar rule').toBeGreaterThan(0)
    expect(bar).toMatch(/(^|[;\s])height\s*:\s*var\(--bar-lg\)/)
    expect(bar).not.toMatch(/(^|[;\s])(min-)?height\s*:\s*\d+px/)
  })

  it('.trailing does not hide overflow and pads its right edge with --space-1', () => {
    const trailing = body('trailing')
    expect(trailing.length, 'the .trailing rule').toBeGreaterThan(0)
    expect(trailing).not.toMatch(/overflow(-[xy])?\s*:\s*hidden/)
    expect(trailing).toMatch(/padding-right\s*:\s*var\(--space-1\)/)
  })
})
