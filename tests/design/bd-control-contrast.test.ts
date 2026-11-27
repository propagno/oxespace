// Frozen acceptance test for 1.5.2 Polimento · Componentes base (Jira OXE-193, PB-01·2, CA-1: the backend). Written by
// the planner; the executor must not edit it. Item: oxespace-ux-ag/POLISH-01-componentes-base.md #2, adjusted by MARCA:
// --bd-strong stays as it is in the whole app; a NEW generated token --bd-control (>= 3:1 in both modes) is the edge of
// field, select, checkbox, the off switch track and the secondary button.
// Contract (src/design/tokens): the generator (tokensCss() in css.ts, from the roles in semantic.ts) emits --bd-control,
// by that short name, in the light block, the dark block and the system-dark fallback; it measures >= 3:1 against
// --surface-canvas and --surface-raised in both modes; the committed src/styles/tokens.generated.css carries it (npm run
// tokens) and --bd-strong keeps today's values. Red today: there is no --bd-control.
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

describe('PB-01·2 · --bd-control, the generated edge of controls', () => {
  test('the generator emits --bd-control in light, dark and the system-dark fallback, at 3:1 or more on the canvas and raised surfaces', () => {
    const css = tokensCss()
    for (const [mode, selector] of [['light', LIGHT], ['dark', DARK], ['system dark', FALLBACK]] as const) {
      const roles = block(css, selector)
      const edge = roles['--bd-control'] ?? ''
      expect(edge, `--bd-control in ${mode}`).toMatch(/^#[0-9a-f]{6}$/i)
      for (const surface of ['--surface-canvas', '--surface-raised']) {
        expect(contrast(edge, roles[surface]), `${mode}: --bd-control on ${surface}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  test('the committed tokens.generated.css carries --bd-control in both modes, as the generator writes it', () => {
    const committed = pbRead('src/styles/tokens.generated.css')
    const css = tokensCss()
    for (const selector of [LIGHT, DARK]) {
      const generated = block(css, selector)['--bd-control'] ?? ''
      expect(generated, `--bd-control from the generator in ${selector}`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(block(committed, selector)['--bd-control'], selector).toBe(generated)
    }
  })

  // OXE-459: updated from violet-neutral (#c3c3d5 / #413e71) to achromatic Obsidian Minimal neutral (#cccccc / #444444).
  test('--bd-strong keeps the calibrated neutral strong border values in both modes', () => {
    const css = tokensCss()
    expect(block(css, LIGHT)['--bd-strong']).toBe('#cccccc')
    expect(block(css, DARK)['--bd-strong']).toBe('#444444')
  })
})
