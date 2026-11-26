// Frozen acceptance test for 1.5.2 OxeChat F5 · conversa AG-10/11, criterion A14 (task T14, the brand targets before
// the UI). Written by the planner; the executor must not edit it. Source: MARCA's CENAS-E-ALVOS-20261115.md part B (via
// the coordinator, 15/11): the AG-10/11 brand measures are a TARGET of this phase, as src/design/targets/brd-25.json; each
// measure starts pending and turns enforced in the PR that delivers its surface (T3, T5, T6, T7, T8, T10, T12, T13);
// the conformance scenes they need go into e2e/brand/brand-conformance.spec.ts with the existing hooks only (the thread
// fixtures and setThreadState; no real data). MARCA's data-ui are proposals: the planner fixed them to this phase's
// hooks (prompt-card, turn, turn-line, explore-group, step with data-kind/data-state, step-output, reasoning, alert,
// md-table, request-card, working-set, composer-toolbar, mode-switch, chat-meta).
// Today (main 12b8e900b): there is no brd-25.json; the conformance spec measures only height, width, font-size,
// font-weight, font-family, border-radius and count, selects by a CSS selector or a whole-scene text, and has no
// chat-anatomy scene; the thread fixtures have no 'anatomy' state.
// Contract:
// - MARCA 15/11 (answers 4 and 7): --measure-chat = 800px is a GENERATED token (src/design/tokens → npm run tokens →
//   src/styles/tokens.generated.css, the same in both densities; the Android tokens regenerate), and the column measures
//   it; the request's split ▾ is measured as one icon-button (BRD-25.request.split).
// - src/design/targets/brd-25.json: { brd: 'BRD-25', card: 'OXE-167, OXE-172', platform: 'desktop', source, measures }
//   with exactly the 20 measures below (id, scene, select, prop, expect, and when needed `of` / `attr`), tolerance 0.5,
//   both densities and both themes; each `pending` or `enforced` (an enforced one is in enforced.lock.json).
// - The props the spec measures grow by: margin-block-start, border-left-width, border-left-color, background-color
//   (colours compared with the token's computed value), inline-start-offset (the element's left edge minus the left
//   edge of `of`), attr (the attribute named by `attr`, compared with expect.eq); expect grows by { max } for a count;
//   select grows by { text, within } (a text counted inside one element). tests/unit/brand-targets.test.ts (not frozen)
//   learns the same and lists brd-25.json.
// - e2e/helpers/thread-fixtures.ts gains the state 'anatomy': one conversation seeded with AG-11 situations 1.2, 2.1,
//   2.3, 2.4b, 2.4c, 3.2, 3.3, 3.4, 5.1, 6.1 and 6.2 (5.2 is chat-approval's); the conformance spec measures the scene
//   'chat-anatomy' after setThreadState(…, 'anatomy'), like the chat-approval scene (a miss reports "no element").
// - The run proves it: with the brand config built and run (BRAND_OUT), every BRD-25 id has a result per density and
//   theme, none "unsupported" (tests/oxe152/chat-f5/f5-brd25-run.test.ts reads that output in the same remote run).
import { describe, expect, test } from 'vitest'
import { THREAD_STATES } from '../../../e2e/helpers/thread-fixtures'
// ---- repository text and catalog strings (inlined in each frozen file so every task's PR stands alone) ----
import { existsSync as pbExistsFile, readdirSync as pbReaddir, readFileSync as pbReadFile } from 'node:fs'
import { join as pbJoin } from 'node:path'

const pbRead = (rel: string): string => pbReadFile(pbJoin(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const pbCatalogs: Record<string, unknown> = {}
/** The catalog text of `ns:key` (shared/locales/<lang>/<ns>.json, English by default), so elements are found by what a person reads. */
function cat(ns: string, key: string, vars: Record<string, string | number> = {}, lang = 'en'): string {
  pbCatalogs[`${lang}/${ns}`] ??= JSON.parse(pbRead(`shared/locales/${lang}/${ns}.json`))
  let node: unknown = pbCatalogs[`${lang}/${ns}`]
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the ${lang} ${ns} catalog has no key ${key}`)
  return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? `{{${name}}}`))
}
/** Every key path of a catalog, flattened ("a.b.c" -> text). */
function flatCatalog(ns: string, lang: string): Record<string, string> {
  const walk = (value: unknown, prefix: string): Record<string, string> => Object.assign({}, ...Object.entries(value as Record<string, unknown>).map(([key, item]) =>
    typeof item === 'string' ? { [prefix + key]: item } : walk(item, `${prefix}${key}.`)))
  return walk(JSON.parse(pbRead(`shared/locales/${lang}/${ns}.json`)), '')
}
/** The key that holds `en` in English and `pt` in pt-BR, or '' (a new pair of words the task adds to both catalogs). */
function pairKey(ns: string, en: string, pt: string): string {
  const english = flatCatalog(ns, 'en'), portuguese = flatCatalog(ns, 'pt-BR')
  return Object.keys(english).find(key => english[key] === en && portuguese[key] === pt) ?? ''
}
/** State and note of one measure of src/design/targets (undefined when absent). SOURCE-TEXT (marked): the target files are data. */
function measureOf(id: string): { state: string; note?: string } | undefined {
  const name = id.split('.')[0].toLowerCase()
  if (!pbExistsFile(pbJoin(process.cwd(), `src/design/targets/${name}.json`))) return undefined
  return (JSON.parse(pbRead(`src/design/targets/${name}.json`)) as { measures: Array<{ id: string; state: string; note?: string }> }).measures.find(item => item.id === id)
}
/** The OxeChat brand measures (src/design/targets, OXE-149) that are not enforced and locked yet. SOURCE-TEXT (marked): the target files are data. */
function notEnforced(ids: readonly string[]): string[] {
  const lock = (JSON.parse(pbRead('src/design/targets/enforced.lock.json')) as { enforced: string[] }).enforced
  const measures = new Map(['brd-02', 'brd-04', 'brd-05', 'brd-25'].filter(name => pbExistsFile(pbJoin(process.cwd(), `src/design/targets/${name}.json`))).flatMap(name => (JSON.parse(pbRead(`src/design/targets/${name}.json`)) as { measures: Array<{ id: string; state: string }> }).measures).map(item => [item.id, item.state]))
  return ids.flatMap(id => [...(!measures.has(id) ? [`${id} is not in src/design/targets`] : measures.get(id) === 'enforced' ? [] : [`${id} is ${measures.get(id)}`]), ...(lock.includes(id) ? [] : [`${id} is not in enforced.lock.json`])])
}
type Target = { id: string; scene: string; select: string | { text: string; within?: string }; prop: string; expect: Record<string, unknown>; of?: string; attr?: string; state: string; tolerance: number; densities: string[]; themes: string[] }
const BRD25: Array<Omit<Target, 'state' | 'tolerance' | 'densities' | 'themes'>> = [
  { id: 'BRD-25.column.width', scene: 'chat-conversation', select: '[data-ui=chat-column]', prop: 'width', expect: { token: '--measure-chat' } },
  // OXE-441: explicit user decision supersedes AG-10 §2.1 left-axis prompt card with a right-aligned user bubble.
  { id: 'BRD-25.prompt.align', scene: 'chat-conversation', select: '[data-ui=prompt-card]', prop: 'inline-end-offset', of: '[data-ui=chat-column]', expect: { px: 0 } },
  { id: 'BRD-25.prompt.radius', scene: 'chat-conversation', select: '[data-ui=prompt-card]', prop: 'border-radius', expect: { token: '--radius-lg' } },
  { id: 'BRD-25.turn-gap', scene: 'chat-anatomy', select: '[data-row-index]:not([data-row-index="0"]) > [data-ui=turn][data-turn-start]', prop: 'margin-block-start', expect: { token: '--space-6' } },
  { id: 'BRD-25.fold.height', scene: 'chat-anatomy', select: '[data-ui=turn-line]', prop: 'height', expect: { token: '--row-1' } },
  { id: 'BRD-25.step.height', scene: 'chat-anatomy', select: '[data-ui=explore-group] [data-ui=step]', prop: 'height', expect: { px: 24 } },
  { id: 'BRD-25.reasoning.font', scene: 'chat-anatomy', select: '[data-ui=reasoning]', prop: 'font-family', expect: { token: '--font-ui' } },
  { id: 'BRD-25.run-failed.open', scene: 'chat-anatomy', select: '[data-ui=step][data-kind=run][data-state=failed] [aria-expanded]', prop: 'attr', attr: 'aria-expanded', expect: { eq: 'true' } },
  { id: 'BRD-25.run-ok.closed', scene: 'chat-anatomy', select: '[data-ui=step][data-kind=run][data-state=done] [aria-expanded]', prop: 'attr', attr: 'aria-expanded', expect: { eq: 'false' } },
  { id: 'BRD-25.stderr.bg', scene: 'chat-anatomy', select: '[data-ui=step][data-state=failed] [data-ui=step-output]', prop: 'background-color', expect: { token: '--term-bg' } },
  { id: 'BRD-25.table.vrule', scene: 'chat-anatomy', select: '[data-ui=md-table] td + td', prop: 'border-left-width', expect: { px: 0 } },
  { id: 'BRD-25.alert.count', scene: 'chat-anatomy', select: '[data-ui=alert]', prop: 'count', expect: { eq: 4 } },
  { id: 'BRD-25.request.rule', scene: 'chat-approval', select: '[data-ui=request-card]', prop: 'border-left-color', expect: { token: '--attn' } },
  { id: 'BRD-25.request.buttons', scene: 'chat-approval', select: '[data-ui=request-card] [data-ui=button]', prop: 'count', expect: { eq: 2 } },
  { id: 'BRD-25.request.split', scene: 'chat-approval', select: '[data-ui=request-card] [data-ui=allow-menu][aria-haspopup=menu]', prop: 'count', expect: { eq: 1 } },
  { id: 'BRD-25.working-set.height', scene: 'chat-anatomy', select: '[data-ui=working-set]', prop: 'height', expect: { token: '--bar-sm' } },
  { id: 'BRD-25.composer.mode-first', scene: 'chat-conversation', select: '[data-ui=composer-toolbar] > :first-child', prop: 'attr', attr: 'data-ui', expect: { eq: 'mode-switch' } },
  { id: 'BRD-25.composer.controls', scene: 'chat-conversation', select: '[data-ui=composer-toolbar] [data-ui=button], [data-ui=composer-toolbar] [data-ui=icon-button]', prop: 'count', expect: { max: 6 } },
  { id: 'BRD-25.header.meta', scene: 'chat-conversation', select: '[data-ui=chat-header] [data-ui=chat-meta]', prop: 'count', expect: { eq: 0 } },
  { id: 'BRD-25.echo.needs-you', scene: 'chat-approval', select: { text: 'Needs you', within: '[data-ui=chat-column]' }, prop: 'count', expect: { eq: 0 } }
]
const file = (): { brd: string; platform: string; source: string; measures: Target[] } => JSON.parse(pbRead('src/design/targets/brd-25.json'))
type Ev = Record<string, unknown> & { type: string }
const anatomy = (): Ev[] => ((THREAD_STATES as unknown as Record<string, { events?: Ev[] } | undefined>).anatomy?.events ?? [])

describe('A14 · the AG-10/11 brand targets (brd-25.json) and the chat-anatomy scene', () => {
  // OXE-401: --measure-chat widened from 800px to 1080px
  test('the token generator emits --measure-chat: 1080px, the same in both densities (MARCA 15/11, answer 4; OXE-401)', () => {
    const css = pbRead('src/styles/tokens.generated.css')
    const block = (selector: string): string => { const at = css.indexOf(`${selector} {`); return at < 0 ? '' : css.slice(at, css.indexOf('}', at)) }
    expect(block(':root'), 'in the base :root block').toMatch(/--measure-chat:\s*1080px;/)
    const comfortable = block(":root[data-density='comfortable']")
    expect(/--measure-chat:\s*(?!1080px)/.test(comfortable), 'comfortable keeps 1080px').toBe(false)
    expect(pbRead('src/design/tokens/scales.ts'), 'from the token source, not hand-written (SOURCE-TEXT, marked)').toMatch(/measure-chat|measureChat/)
  })

  test('brd-25.json holds exactly the 20 AG-10/11 measures, as the plan fixed them', () => {
    const doc = file()
    expect([doc.brd, doc.platform]).toEqual(['BRD-25', 'desktop'])
    expect(doc.source).toBeTruthy()
    expect(doc.measures.map(measure => measure.id)).toEqual(BRD25.map(measure => measure.id))
    for (const [index, measure] of doc.measures.entries()) {
      const want = BRD25[index]
      expect({ scene: measure.scene, select: measure.select, prop: measure.prop, expect: measure.expect, of: measure.of, attr: measure.attr }, measure.id)
        .toEqual({ scene: want.scene, select: want.select, prop: want.prop, expect: want.expect, of: want.of, attr: want.attr })
      expect(['pending', 'enforced'], measure.id).toContain(measure.state)
      expect(measure.tolerance, measure.id).toBe(0.5)
      expect([...measure.densities].sort(), measure.id).toEqual(['comfortable', 'compact'])
      expect([...measure.themes].sort(), measure.id).toEqual(['dark', 'light'])
    }
  })

  test('an enforced BRD-25 measure is in the lock', () => {
    const lock = (JSON.parse(pbRead('src/design/targets/enforced.lock.json')) as { enforced: string[] }).enforced
    for (const measure of file().measures.filter(item => item.state === 'enforced')) expect(lock, measure.id).toContain(measure.id)
  })

  test('the thread fixtures seed the anatomy state with the situations the scene measures', () => {
    const events = anatomy()
    expect(events.length, 'an anatomy state').toBeGreaterThan(0)
    const tools = events.filter(event => event.type === 'tool')
    const has = (label: string, ok: boolean): void => { expect(ok, label).toBe(true) }
    has('1.2 a finished thought', events.some(event => event.type === 'reasoning' && typeof event.completedAt === 'number'))
    let run = 0, longest = 0
    for (const event of events) { run = event.type === 'tool' && ['Read', 'Grep', 'Glob'].includes(String(event.name)) ? run + 1 : 0; longest = Math.max(longest, run) }
    has('2.1 a run of reads and searches', longest >= 5)
    has('2.3 an edit with its files', tools.some(event => Array.isArray(event.files) && event.files.length > 0))
    has('2.4b a command with exit 0', tools.some(event => event.name === 'Bash' && event.exitCode === 0))
    has('2.4c a failed command with output', tools.some(event => event.name === 'Bash' && typeof event.exitCode === 'number' && event.exitCode !== 0 && Boolean(event.output)))
    const text = events.filter(event => event.type === 'message' && event.role === 'assistant').map(event => String(event.text)).join('\n')
    has('3.2 a ts code block', /```ts\n/.test(text))
    has('3.3 a table', /\n\|[^\n]+\|\n\|\s*-{3}/.test(text))
    for (const kind of ['NOTE', 'IMPORTANT', 'WARNING', 'CAUTION']) has(`3.4 [!${kind}]`, text.includes(`> [!${kind}]`))
    has('5.1 a plan', events.some(event => event.type === 'plan'))
    has('6.1 a turn that changed 3 files', tools.flatMap(event => (event.files as unknown[] | undefined) ?? []).length >= 3)
    has('6.2 a compaction', tools.some(event => event.name === 'contextCompaction'))
    has('6.2 a failure', events.some(event => event.type === 'completed' && event.status === 'failed'))
    has('two turns or more (the turn gap)', events.filter(event => event.type === 'message' && event.role === 'user').length >= 2)
  })

  test('the conformance spec measures the chat-anatomy scene and the new props (SOURCE-TEXT check, marked: the spec runs only in the built app)', () => {
    const spec = pbRead('e2e/brand/brand-conformance.spec.ts')
    expect(spec).toMatch(/setThreadState\([^)]*['"]anatomy['"]/)
    expect(spec).toMatch(/measureScene\([^)]*['"]chat-anatomy['"]/)
    for (const prop of ['margin-block-start', 'border-left-width', 'border-left-color', 'background-color', 'inline-start-offset', 'inline-end-offset', "'attr'"]) expect(spec, prop).toContain(prop)
    expect(spec, 'a count can have a max').toMatch(/\bmax\b/)
    expect(spec, 'a text can be counted within an element').toMatch(/\bwithin\b/)
  })

  test('the README lists BRD-25 with the cards and hooks it measures', () => {
    expect(pbRead('src/design/targets/README.md')).toMatch(/BRD-25|brd-25/)
  })
})
