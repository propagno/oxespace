// Frozen acceptance test for 1.5.2 OxeChat F5 · conversa AG-10/11, criterion A14 (task T14), second half: it reads the
// output of the brand conformance run that the acceptance command makes just before it, in the same remote run
// (BRAND_OUT=brand-out/f5-brd25.json npx playwright test -c playwright.brand.config.ts). Written by the planner; the
// executor must not edit it. Every BRD-25 measure must have been measured in both densities and both themes, and none
// may come back as a prop or select the spec does not know (a surface not built yet reports "no element": that is
// the pending state, and it is fine here).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

type Result = { id: string; density: string; theme: string; scene: string; ok: boolean; measured: string; detail?: string }
const OUT = join(process.cwd(), 'brand-out', 'f5-brd25.json')

describe('A14 · the brand run measures every BRD-25 target', () => {
  test('every BRD-25 id has a result per density and theme, none unsupported', () => {
    expect(existsSync(OUT), `the brand run wrote ${OUT}`).toBe(true)
    const results = (JSON.parse(readFileSync(OUT, 'utf8')) as { results: Result[] }).results.filter(result => result.id.startsWith('BRD-25.'))
    const ids = (JSON.parse(readFileSync(join(process.cwd(), 'src/design/targets/brd-25.json'), 'utf8')) as { measures: Array<{ id: string }> }).measures.map(measure => measure.id)
    expect(ids).toHaveLength(19)
    for (const id of ids) {
      const mine = results.filter(result => result.id === id)
      expect(new Set(mine.map(result => `${result.density}/${result.theme}`)).size, `${id}: both densities and both themes`).toBe(4)
      for (const result of mine) expect(`${result.measured} ${result.detail ?? ''}`, `${id} ${result.density}/${result.theme}`).not.toMatch(/unsupported|unknown (prop|select)|not supported/i)
    }
  })
})
