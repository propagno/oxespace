// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-208, PU-03·3, CA-1 and CA-2; brand-approved POLISH-03 #3).
// Written by the planner; the executor must not edit it. Runs after T31 (BRD-12 puts the Ramo mark on the first run).
// Today (main 4b7015c89) the app icon's tile (--logo-tile, #1b1925) on the dark canvas measures 1.11:1 and disappears
// behind the mark, in the boot splash (src/styles/splash.css .oxe-splash-tile) and in OxeLogo (OxeLogo.module.css .tile).
// Contract (SOURCE-TEXT checks, marked: jsdom computes no SVG paint; the e2e spec pu-03-3 reads the computed stroke):
// - In the dark theme (the root's data-mode='dark', src/design/mode.ts) both tiles get a 1px inner outline in
//   var(--bd-subtle): a rule scoped to [data-mode='dark'] (or prefers-color-scheme: dark for the splash, which paints
//   before any script) gives the tile a stroke of var(--bd-subtle).
// - In the light theme nothing changes: no rule outside a dark scope gives either tile a stroke.
// - OxeLogo still draws the tile as the first rect of its svg (the stroke has something to sit on).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OxeLogo } from '../../../src/components/Brand/OxeLogo'

const ROOT = process.cwd()
const css = (file: string): string => readFileSync(join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const DARK = /\[data-mode=["']?dark["']?\]|prefers-color-scheme:\s*dark/
/** Every rule as [scope, selector, body], where scope is the enclosing at-rule prelude ('' at the top level). */
function rules(text: string): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = []
  const walk = (chunk: string, scope: string): void => {
    let index = 0
    while (index < chunk.length) {
      const open = chunk.indexOf('{', index)
      if (open < 0) return
      const head = chunk.slice(index, open).trim()
      let depth = 1
      let end = open + 1
      while (end < chunk.length && depth > 0) { if (chunk[end] === '{') depth++; else if (chunk[end] === '}') depth--; end++ }
      const body = chunk.slice(open + 1, end - 1)
      if (head.startsWith('@')) walk(body, head); else out.push([scope, head, body])
      index = end
    }
  }
  walk(text, '')
  return out
}
const stroked = (file: string, tile: RegExp): Array<[string, string, string]> => rules(css(file)).filter(([, selector, body]) => tile.test(selector) && /(^|;|\s)stroke\s*:/.test(body))

afterEach(() => { cleanup() })

describe('OXE-208 PU-03·3 the Ramo tile reads on the dark canvas', () => {
  it.each([
    ['src/styles/splash.css', /\.oxe-splash-tile\b/],
    ['src/components/Brand/OxeLogo.module.css', /\.tile\b/]
  ])('%s outlines the tile in --bd-subtle in the dark theme', (file, tile) => {
    const dark = stroked(file, tile).filter(([scope, selector]) => DARK.test(scope) || DARK.test(selector))
    expect(dark.length, 'a dark-scoped stroke rule for the tile').toBeGreaterThan(0)
    expect(dark.map(([, , body]) => body).join(';')).toMatch(/stroke\s*:\s*var\(--bd-subtle\)/)
  })

  it.each([
    ['src/styles/splash.css', /\.oxe-splash-tile\b/],
    ['src/components/Brand/OxeLogo.module.css', /\.tile\b/]
  ])('%s leaves the light theme as it is: no stroke outside the dark scope', (file, tile) => {
    const light = stroked(file, tile).filter(([scope, selector]) => !DARK.test(scope) && !DARK.test(selector))
    expect(light).toEqual([])
  })

  it('OxeLogo still draws its tile as the svg\'s first rect', () => {
    const { container } = render(<OxeLogo size={32} />)
    const rect = container.querySelector('svg rect')
    expect(rect, 'the tile rect').not.toBeNull()
    expect(rect?.getAttribute('class') ?? '').toMatch(/tile/)
  })
})
