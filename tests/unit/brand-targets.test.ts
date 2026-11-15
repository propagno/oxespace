import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * The approved brand target as data (OXE-149): src/design/targets/brd-NN.json holds, per BRD, each measure the built
 * app must match. e2e/brand-conformance.spec.ts reads the same files. A measure starts `pending` (reported, never
 * failing) and turns `enforced` in the PR that delivers its BRD, which also adds its id to enforced.lock.json; an
 * enforced measure never goes back (CA-3).
 */
type Expect =
  | { token: string }
  | { oneOf: string[] }
  | { px: number }
  | { sp: number }
  | { eq: number }
  | { gte: number }
type Measure = {
  id: string
  scene: string
  select: string | { text: string }
  prop: string
  expect: Expect
  tolerance: number
  densities: string[]
  themes: string[]
  state: 'pending' | 'enforced'
  note?: string
}
type TargetFile = { brd: string; card: string | null; title: string; platform: 'desktop' | 'android'; source: string; measures: Measure[] }

const dir = join(process.cwd(), 'src/design/targets')
const files = readdirSync(dir).filter(name => /^brd-\d{2}\.json$/.test(name)).sort()
const targets = files.map(name => ({ name, doc: JSON.parse(readFileSync(join(dir, name), 'utf8')) as TargetFile }))
const lock = JSON.parse(readFileSync(join(dir, 'enforced.lock.json'), 'utf8')) as { enforced: string[] }
const generated = readFileSync(join(process.cwd(), 'src/styles/tokens.generated.css'), 'utf8')
const tokenNames = new Set([...generated.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]))
const measures = targets.flatMap(({ doc }) => doc.measures.map(measure => ({ ...measure, brd: doc.brd, platform: doc.platform })))

const DESKTOP_PROPS = new Set(['height', 'width', 'font-size', 'font-weight', 'font-family', 'border-radius', 'count'])
const ANDROID_PROPS = new Set(['font-size', 'font-weight', 'min-font-size', 'radius'])

describe('brand targets (OXE-149)', () => {
  test('the targets are valid and every BRD-01..07 has measures', () => {
    expect(files).toEqual(['brd-01.json', 'brd-02.json', 'brd-03.json', 'brd-04.json', 'brd-05.json', 'brd-06.json', 'brd-07.json', 'brd-09.json', 'brd-10.json', 'brd-11.json', 'brd-12.json', 'brd-13.json', 'brd-14.json', 'brd-15.json', 'brd-16.json'])
    for (const { name, doc } of targets) {
      expect(doc.brd.toLowerCase() + '.json', name).toBe(name)
      expect(['desktop', 'android'], name).toContain(doc.platform)
      expect(doc.source, name).toBeTruthy()
      expect(doc.measures.length, name).toBeGreaterThan(0)
    }
    const ids = measures.map(measure => measure.id)
    expect(new Set(ids).size, 'measure ids are unique').toBe(ids.length)
    for (const measure of measures) {
      const where = measure.id
      expect(measure.id.startsWith(`${measure.brd}.`), where).toBe(true)
      expect(['pending', 'enforced'], where).toContain(measure.state)
      expect(measure.tolerance, where).toBeGreaterThanOrEqual(0)
      expect(measure.tolerance, where).toBeLessThanOrEqual(0.5)
      expect(measure.themes.length, where).toBeGreaterThan(0)
      expect(measure.densities.length, where).toBeGreaterThan(0)
      const props = measure.platform === 'desktop' ? DESKTOP_PROPS : ANDROID_PROPS
      expect(props.has(measure.prop), `${where}: prop ${measure.prop}`).toBe(true)
      if (measure.platform === 'desktop') {
        expect(measure.densities.every(density => density === 'compact' || density === 'comfortable'), where).toBe(true)
        expect(measure.themes.every(theme => theme === 'light' || theme === 'dark'), where).toBe(true)
        // Classes are hashed, so a measure finds its element by data-ui, ARIA role, a tag or text, never by class.
        if (typeof measure.select === 'string') expect(measure.select, where).not.toMatch(/(^|[\s>+~,(])\.[A-Za-z_-]/)
        else expect(measure.select.text, where).toBeTruthy()
      }
    }
  })

  test('desktop targets name generated tokens, so both densities and themes come from one source', () => {
    for (const measure of measures.filter(item => item.platform === 'desktop')) {
      const expected = measure.expect
      const names = 'token' in expected ? [expected.token] : 'oneOf' in expected ? expected.oneOf : []
      for (const name of names) expect(tokenNames.has(name), `${measure.id}: ${name} is not in tokens.generated.css`).toBe(true)
      if (measure.prop === 'count') expect('eq' in expected, measure.id).toBe(true)
      else expect('token' in expected || 'oneOf' in expected || 'px' in expected, measure.id).toBe(true)
    }
  })

  test('ratchet: an enforced measure never goes back to pending, and the lock lists exactly the enforced ones', () => {
    const byId = new Map(measures.map(measure => [measure.id, measure]))
    for (const id of lock.enforced) {
      expect(byId.has(id), `${id} is in enforced.lock.json but no target has it`).toBe(true)
      expect(byId.get(id)?.state, `${id} was enforced and must stay enforced`).toBe('enforced')
    }
    const enforced = measures.filter(measure => measure.state === 'enforced').map(measure => measure.id).sort()
    expect(enforced, 'add the id to enforced.lock.json in the PR that enforces it').toEqual([...lock.enforced].sort())
  })
})
