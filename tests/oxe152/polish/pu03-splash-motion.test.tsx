// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-207, PU-03·2, CA-1; brand-approved POLISH-03 #2, WCAG 2.3.3,
// docs/design/motion.md "reduced motion from the first frame"). Written by the planner; the executor must not edit it.
// Today (main 4b7015c89) .oxe-splash-arm runs oxe-pulse forever before React loads; the global reduced-motion rule of
// base.css only shortens animations, so under reduced motion the splash still pulses.
// CA-2 (an inline boot script in index.html that reads the saved choice) cannot be met as written: the renderer's CSP is
// script-src 'self' and tests/csp-lock.test.ts pins index.html to the one module script (asked of the coordinator, 15/11).
// What holds instead: the operating system's choice is CSS (the first frame), and a saved "Reduced" choice is applied by
// src/design/motion.ts the moment the module runs (savedMotion, resolveMotion, applyMotion), which turns the arms off too.
// Contract:
// - SOURCE-TEXT check (marked; the computed animation is the e2e spec pu-03-2's): src/styles/splash.css turns the arms'
//   animation off (animation: none or animation-name: none) under @media (prefers-reduced-motion: reduce) and under
//   [data-motion='reduce'].
// - index.html keeps the CSP lock: no inline script (the boot splash stays drawn by the stylesheet alone).
// - The saved choice resolves as the module applies it: a saved "Reduced" is 'reduce' whatever the system says.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyMotion, resolveMotion, savedMotion } from '../../../src/design/motion'

const ROOT = process.cwd()
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

afterEach(() => { window.localStorage.clear(); delete document.documentElement.dataset.motion })

describe('OXE-207 PU-03·2 the splash honours reduced motion', () => {
  it('splash.css turns the arms off under prefers-reduced-motion and data-motion="reduce" (source text, marked)', () => {
    const css = readFileSync(join(ROOT, 'src/styles/splash.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const off = /animation(-name)?\s*:\s*none/
    const media = atBlocks(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/).join('\n')
    expect(media, 'a prefers-reduced-motion: reduce block for the arms').toMatch(/\.oxe-splash-arm/)
    expect(media).toMatch(off)
    const rules = [...css.matchAll(/([^{}]*\[data-motion=["']?reduce["']?\][^{}]*\.oxe-splash-arm[^{}]*)\{([^}]*)\}/g)].map(match => match[2])
    expect(rules.length, 'a [data-motion=reduce] rule for the arms').toBeGreaterThan(0)
    expect(rules.join(';')).toMatch(off)
  })

  it('index.html keeps the CSP lock: the module entry is its only script', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
    expect([...html.matchAll(/<script\b([^>]*)>/g)].map(match => match[1].trim())).toEqual(['type="module" src="/src/main.tsx"'])
  })

  it('a saved "Reduced" choice resolves to reduce and marks the document, whatever the system says', () => {
    window.localStorage.setItem('oxe-settings', JSON.stringify({ state: { motion: 'reduce' }, version: 3 }))
    const motion = resolveMotion(savedMotion(), false)
    expect(motion).toBe('reduce')
    applyMotion(motion)
    expect(document.documentElement.dataset.motion).toBe('reduce')
  })
})
