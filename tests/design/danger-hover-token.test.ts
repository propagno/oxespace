// Frozen acceptance test for 1.5.2 Polimento · Componentes base (Jira OXE-205, PB-01·14, CA-1: the backend). Written by
// the planner; the executor must not edit it. Item: oxespace-ux-ag/POLISH-01-componentes-base.md #14, adjusted by MARCA:
// the danger hover is a generated token, never a loose color-mix or a filter.
// Contract (src/design/tokens): the generator (tokensCss() in css.ts, from the roles in semantic.ts) emits
// --intent-danger-solid-hover in the light block, the dark block and the system-dark fallback, as a colour of its own
// (not var(), not color-mix(), not equal to --intent-danger-solid); the label on it, --tx-on-solid, reads at >= 4.5:1 in
// both modes; the committed src/styles/tokens.generated.css carries it (npm run tokens). Red today: no such token.
import { describe, expect, test } from 'vitest'
import { contrast } from '../../src/design/tokens/color'
import { tokensCss } from '../../src/design/tokens/css'
// ---- repository text and catalog strings (inlined in each frozen file so every task's PR stands alone) ----
import { readFileSync as pbReadFile } from 'node:fs'
import { join as pbJoin } from 'node:path'

const pbRead = (rel: string): string => pbReadFile(pbJoin(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const pbCatalogs: Record<string, unknown> = {}
/** The English catalog text of `ns:key` (shared/locales/en/<ns>.json), so elements are found by what a person reads. */
function cat(ns: string, key: string, vars: Record<string, string | number> = {}): string {
  pbCatalogs[ns] ??= JSON.parse(pbRead(`shared/locales/en/${ns}.json`))
  let node: unknown = pbCatalogs[ns]
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the en ${ns} catalog has no key ${key}`)
  return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? `{{${name}}}`))
}
const LIGHT = ":root, [data-mode='light']"
const DARK = ":root[data-mode='dark'], [data-mode='dark']"
const FALLBACK = ':root:not([data-mode])'
/** The declarations of one block of a token stylesheet, by its exact selector. */
function block(text: string, selector: string): Record<string, string> {
  const at = text.indexOf(`${selector} {`)
  expect(at, `block ${selector}`).toBeGreaterThanOrEqual(0)
  const body = text.slice(at + selector.length + 2, text.indexOf('}', at))
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
}

describe('PB-01·14 · --intent-danger-solid-hover, a generated hover for the danger button', () => {
  test('the generator emits --intent-danger-solid-hover in light, dark and the system-dark fallback, a colour of its own', () => {
    const css = tokensCss()
    for (const [mode, selector] of [['light', LIGHT], ['dark', DARK], ['system dark', FALLBACK]] as const) {
      const roles = block(css, selector)
      const hover = roles['--intent-danger-solid-hover'] ?? ''
      expect(hover, `--intent-danger-solid-hover in ${mode}`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(hover.toLowerCase(), `${mode}: the hover differs from the resting fill`).not.toBe(roles['--intent-danger-solid'].toLowerCase())
    }
  })

  test('the label on the hover fill (--tx-on-solid) reads at 4.5:1 or more in both modes', () => {
    const css = tokensCss()
    for (const [mode, selector] of [['light', LIGHT], ['dark', DARK]] as const) {
      const roles = block(css, selector)
      const hover = roles['--intent-danger-solid-hover'] ?? ''
      expect(hover, `--intent-danger-solid-hover in ${mode}`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(contrast(roles['--tx-on-solid'], hover), mode).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('the committed tokens.generated.css carries the hover token in both modes, as the generator writes it', () => {
    const committed = pbRead('src/styles/tokens.generated.css')
    const css = tokensCss()
    for (const selector of [LIGHT, DARK]) {
      const generated = block(css, selector)['--intent-danger-solid-hover'] ?? ''
      expect(generated, `--intent-danger-solid-hover from the generator in ${selector}`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(block(committed, selector)['--intent-danger-solid-hover'], selector).toBe(generated)
    }
  })
})
