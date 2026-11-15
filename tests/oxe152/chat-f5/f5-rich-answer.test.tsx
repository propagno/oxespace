// Frozen acceptance test for 1.5.2 OxeChat F5 · conversa AG-10/11, criterion A8 (task T8). Written by the planner; the
// executor must not edit it. Source: AG-11-CRITERIOS-F5.md (MARCA 15/11) rows 3.1, 3.2, 3.3, 3.5, 4.2 and 4.3, the rules
// "Espaços" (16 px between prose and a rich block) and "Texto" ("Não foi possível …", tabular-nums); AG-11 §3 ("Zero
// eco textual": a code block does not repeat "Bloco de código"; a table gets no heavy vertical borders). It builds on
// T3 and T4 (the same ThreadMarkdown.tsx/.css and ThreadMermaid.tsx; depends on both).
// Today (main 12b8e900b): the prose has no reading measure; a fence without a language shows "Code" in its bar; code
// colours come from --intent-*; a table has vertical rules (td+td border-left) in --bd-default and numbers aligned left;
// a diagram whose text is still arriving shows its code with no word, and one that never parses shows only its code.
// Contract ("[css]" cases read the stylesheets, rigor source-assertion):
// - 3.1: paragraphs and lists of the answer read at most 72ch ([css] max-width 72ch on the prose); "- [x]" renders a
//   checked, read-only checkbox; inline code "src/pix/refund.ts:42" with the conversation is a PathLink (a link).
// - 3.2 (MARCA 15/11, answer 6): the language on the left, Copy on the right; Copy turns to Copied for 2 s, announced
//   politely (role=status / aria-live polite).
// - 3.2: a fence's bar shows only the language's name (TypeScript for ```ts) and Copy (markdown.copy → markdown.copied);
//   a fence without a language shows only Copy (never "Code" / "Código" nor "Code block"); the block on
//   --surface-raised; the token colours from --syn-* ([css]: the keyword, string, number, comment and function classes).
// - 3.3: no vertical rules inside a table ([css] no border-left/right between cells), horizontal dividers in
//   --bd-subtle, and a cell whose text is a number is data-numeric="true", [css] right-aligned in tabular-nums; the table
//   scrolls sideways inside its own region (overflow-x auto, kept), the region carrying data-ui="md-table";
//   BRD-25.table.vrule turns enforced.
// - 3.5: $…$ inline and $$…$$ as a centred block (KaTeX, ThreadMath), kept; an image of the answer has [css] a soft
//   border and max-height 480 px, kept.
// - 4.2 / 4.3: ThreadMarkdown takes `streaming` (the message is the turn's latest and the turn runs; ThreadMessageRow
//   passes it) down to MermaidDiagram. While streaming and not drawable yet: "Building the diagram…" / "Montando
//   diagrama…" with the partial code, never an error. Not streaming and not drawable: one line at the top of the block,
//   "Couldn't draw this diagram" / "Não foi possível desenhar o diagrama" (role note), the code still shown and copyable.
// - [css] 16 px between prose and a rich block (code, table, diagram): the blocks' block margin.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ThreadMarkdown } from '../../../src/components/Threads/ThreadMarkdown'
import { changeLanguage, i18n } from '../../../src/i18n'
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
// ---- SOURCE-TEXT (rigor: source-assertion): the stylesheets' rules matched against the RENDERED nodes ----
// jsdom has no layout and no cascade, so the cases named "[css]" read the src/ui CSS Modules and the OxeChat stylesheets (src/components/Threads: its CSS Modules and its plain .css files, whose class names are literal), keep the rules whose selector matches the rendered node (in a state: at rest, under the
// pointer, focused; on a pseudo-element; in forced colours) and take the winning declaration (important, then
// unlayered over @layer, then specificity, then source order). Media queries other than forced-colors are left out.
// The end-to-end spec of the card measures the same thing in the built app.
interface PbRule { bare: string; states: string[]; pseudo: string; forced: boolean; layered: boolean; spec: number; order: number; decls: Array<[string, string, boolean]> }
/** rest; under the pointer; focused (the node or a node inside it); `within`: only a node inside it is focused. */
type PbState = 'rest' | 'hover' | 'focus' | 'within'
const pbUi = import.meta.glob('../../../src/ui/*.module.css', { eager: true }) as Record<string, { default: Record<string, string> }>
const pbTm = import.meta.glob('../../../src/components/Threads/*.module.css', { eager: true }) as Record<string, { default: Record<string, string> }>
/** The plain stylesheets of the OxeChat components (class names as written). */
const pbPlain = (): string[] => pbReaddir(pbJoin(process.cwd(), 'src/components/Threads')).filter(name => name.endsWith('.css') && !name.endsWith('.module.css')).map(name => `src/components/Threads/${name}`)
const PB_STATE = /:(hover|focus-visible|focus-within|focus)(?![\w-])/g
function pbSplit(text: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === sep && depth === 0) { out.push(text.slice(start, i)); start = i + 1 }
  }
  out.push(text.slice(start))
  return out.map(s => s.trim()).filter(Boolean)
}
function pbSpec(selector: string): number {
  const s = selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '')
  const ids = (s.match(/#[\w-]+/g) ?? []).length
  const cls = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!not\(|is\(|has\(|where\()[\w-]+/g) ?? []).length
  const types = (s.match(/(^|[\s>+~(,])[a-zA-Z][\w-]*/g) ?? []).length
  return ids * 10000 + cls * 100 + types
}
let pbOrder = 0
function pbParse(rel: string, classes?: Record<string, string>): PbRule[] {
  const rules: PbRule[] = []
  const walk = (block: string, forced: boolean, layered: boolean): void => {
    let i = 0
    while (i < block.length) {
      const open = block.indexOf('{', i), semi = block.indexOf(';', i)
      if (open === -1) return
      if (semi !== -1 && semi < open && block.slice(i, semi).trim().startsWith('@')) { i = semi + 1; continue }
      let depth = 1, close = open + 1
      for (; close < block.length && depth > 0; close++) { if (block[close] === '{') depth++; else if (block[close] === '}') depth-- }
      const head = block.slice(i, open).trim(), body = block.slice(open + 1, close - 1)
      i = close
      if (head.startsWith('@')) {
        if (/^@layer\b/.test(head)) walk(body, forced, true)
        else if (/^@media\b/.test(head) && /forced-colors:\s*active/.test(head)) walk(body, true, layered)
        else if (/^@(container|supports)\b/.test(head)) walk(body, forced, layered)
        continue
      }
      const decls = pbSplit(body, ';').map(item => {
        const colon = item.indexOf(':')
        const value = item.slice(colon + 1).trim()
        return [item.slice(0, colon).trim().toLowerCase(), value.replace(/\s*!important$/, ''), /!important$/.test(value)] as [string, string, boolean]
      }).filter(([name]) => name)
      for (const raw of pbSplit(head, ',')) {
        const pseudoMatch = /(::?(?:before|after|placeholder|selection))$/.exec(raw)
        const pseudo = pseudoMatch ? pseudoMatch[1].replace(/^:(?!:)/, '::') : ''
        if (!pseudoMatch && raw.includes('::')) continue
        const plain = pseudoMatch ? raw.slice(0, raw.length - pseudoMatch[1].length) : raw
        const mapped = classes ? plain.replace(/\.(-?[_a-zA-Z][\w-]*)/g, (whole, name: string) => classes[name] ? `.${classes[name]}` : whole) : plain
        const states = [...mapped.matchAll(PB_STATE)].map(m => m[1])
        const bare = mapped.replace(/(^|[\s>+~(])(?=:(hover|focus-visible|focus-within|focus)(?![\w-]))/g, '$1*').replace(PB_STATE, '').trim()
        rules.push({ bare, states, pseudo, forced, layered, spec: pbSpec(mapped), order: pbOrder++, decls })
      }
    }
  }
  walk(pbRead(rel).replace(/\/\*[\s\S]*?\*\//g, ''), false, false)
  return rules
}
const PB_RULES: PbRule[] = [
  ...Object.entries(pbUi).flatMap(([path, mod]) => pbParse(`src/ui/${path.split('/').pop()}`, mod.default)),
  ...Object.entries(pbTm).flatMap(([path, mod]) => pbParse(`src/components/Threads/${path.split('/').pop()}`, mod.default)),
  ...pbPlain().flatMap(rel => pbParse(rel))
]
const PB_ALLOWED: Record<PbState, string[]> = { rest: [], hover: ['hover'], focus: ['focus', 'focus-visible', 'focus-within'], within: ['focus-within'] }
interface PbWhen { state?: PbState; forced?: boolean; pseudo?: string }
/**
 * The value a node (or its pseudo-element) takes from the matched rules and its inline style, or undefined when none
 * sets it. Several names (a shorthand and its longhands) compete as one cascade: the last winner names which one won.
 */
function cssWin(node: Element, props: string | string[], { state = 'rest', forced = false, pseudo = '' }: PbWhen = {}): { prop: string; value: string } | undefined {
  const names = Array.isArray(props) ? props : [props]
  const hits: Array<{ prop: string; value: string; important: boolean; layered: boolean; spec: number; order: number }> = []
  for (const rule of PB_RULES) {
    if (rule.forced && !forced) continue
    if (rule.pseudo !== pseudo) continue
    if (!rule.states.every(s => PB_ALLOWED[state].includes(s))) continue
    let ok: boolean
    try { ok = node.matches(rule.bare || '*') } catch { ok = false }
    if (!ok) continue
    for (const [name, value, important] of rule.decls) if (names.includes(name)) hits.push({ prop: name, value, important, layered: rule.layered, spec: rule.spec, order: rule.order })
  }
  if (!pseudo) for (const name of names) {
    const inline = (node as HTMLElement).style?.getPropertyValue(name)
    if (inline) hits.push({ prop: name, value: inline, important: false, layered: false, spec: 1e9, order: 1e9 })
  }
  hits.sort((a, b) => Number(a.important) - Number(b.important) || Number(b.layered) - Number(a.layered) || a.spec - b.spec || a.order - b.order)
  const top = hits.at(-1)
  return top ? { prop: top.prop, value: top.value } : undefined
}
const css = (node: Element, props: string | string[], when: PbWhen = {}): string | undefined => cssWin(node, props, when)?.value
/** Every declaration of `prop` any matching rule makes (all states, both modes), for "never" checks. */
function cssAll(node: Element, prop: string, pseudo = ''): string[] {
  const out: string[] = []
  for (const rule of PB_RULES) {
    if (rule.pseudo !== pseudo) continue
    let ok: boolean
    try { ok = node.matches(rule.bare || '*') } catch { ok = false }
    if (ok) for (const [name, value] of rule.decls) if (name === prop) out.push(value)
  }
  return out
}
const PB_TOKENS = pbRead('src/styles/tokens.generated.css')
/** A generated token by its short name (--fs-*, --tx-*, --bd-* since #845; the long name only if main still emits it). */
function tok(name: string): string {
  if (PB_TOKENS.includes(`--${name}:`)) return `--${name}`
  const long: Record<string, string> = { fs: 'text', tx: 'text', bd: 'border' }
  const [head, ...rest] = name.split('-')
  return long[head] ? `--${long[head]}-${rest.join('-')}` : `--${name}`
}
/** The value is that token (var(--x) or var(--x, fallback)). */
const usesTok = (value: string | undefined, name: string): boolean => !!value && new RegExp(`var\\(\\s*${tok(name)}\\s*[,)]`).test(value)
/** The declarations of one block of tokens.generated.css, by its exact selector. */
function pbBlock(selector: string): Record<string, string> {
  const at = PB_TOKENS.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`tokens.generated.css has no block ${selector}`)
  const body = PB_TOKENS.slice(at + selector.length + 2, PB_TOKENS.indexOf('}', at))
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
}
/**
 * A length in px, resolving var(--token) from tokens.generated.css (the compact :root, or the comfortable density on
 * top of it) and evaluating calc() with + - * /. NaN when the value is not a length this can evaluate.
 */
function px(value: string | undefined, density: 'compact' | 'comfortable' = 'compact'): number {
  if (!value) return NaN
  const vars = { ...pbBlock(':root'), ...(density === 'comfortable' ? pbBlock(":root[data-density='comfortable']") : {}) }
  let text = value
  for (let round = 0; round < 8 && /var\(/.test(text); round++) {
    text = text.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, name: string, fallback?: string) => vars[name] ?? fallback ?? 'NaN')
  }
  const expr = text.replace(/calc\(/g, '(').replace(/(-?\d*\.?\d+)px/g, '$1').trim()
  if (!/^[\d\s.+\-*/()]+$/.test(expr)) return NaN
  try { return Number(new Function(`return (${expr})`)()) } catch { return NaN }
}
vi.mock('mermaid', () => ({ default: {
  initialize: vi.fn(),
  parse: vi.fn(async (code: string) => code.trim().endsWith('D[Post]')),
  render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}" data-test-drawing="yes" viewBox="0 0 10 10"></svg>` }))
} }))

const tt = (key: string, options: Record<string, unknown> = {}): string => i18n.t(key, { ns: 'thread', ...options }) as string
const Markdown = ThreadMarkdown as unknown as (props: { text: string; threadId?: string; streaming?: boolean }) => JSX.Element
const BUILDING = { en: 'Building the diagram…', 'pt-BR': 'Montando diagrama…' } as const
const CANNOT = { en: 'Couldn\'t draw this diagram', 'pt-BR': 'Não foi possível desenhar o diagrama' } as const
const words = (node: Element | null | undefined): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim()
/** The bar's parts in order (the label, then each button), each part's words. */
const barWords = (block: Element): string => [...bar(block).children].map(child => words(child)).filter(Boolean).join(' ')
const bar = (block: Element): HTMLElement => block.querySelector<HTMLElement>('.thread-code-toolbar') ?? (block as HTMLElement)

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('A8 · prose, checklist and links (row 3.1)', () => {
  test('[css] the prose reads at most 72ch', () => {
    render(<Markdown text={'The refund handler retries on a timeout, which can post the same refund twice.\n\n- one\n- two'} />)
    const paragraph = screen.getByText(/The refund handler retries/)
    const measures = [paragraph, paragraph.parentElement!].map(node => css(node, 'max-width')).filter(Boolean)
    expect(measures, 'a 72ch measure').toContain('72ch')
  })

  test('a checklist renders checked, read-only boxes, and file:line is a link that opens the file at the line', () => {
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { resolvePath: vi.fn(async () => ({ kind: 'file', place: { root: '/repo', relativePath: 'src/pix/refund.ts' }, line: 42 })) } } })
    render(<Markdown threadId="thread" text={'- [x] Add the key\n- [ ] Run the tests\n\nSee `src/pix/refund.ts:42`.'} />)
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes.map(box => (box as HTMLInputElement).checked)).toEqual([true, false])
    for (const box of boxes) expect(box).toBeDisabled()
    expect(screen.getByRole('link', { name: /src\/pix\/refund\.ts:42/ })).toBeInTheDocument()
  })
})

describe('A8 · code blocks (row 3.2)', () => {
  test.each(['en', 'pt-BR'] as const)('(%s) the bar shows only the language and Copy, which turns to Copied; no "Code" word', async locale => {
    await changeLanguage(locale)
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<Markdown text={'```ts\nconst key = header()\n```'} />)
    const block = document.querySelector('.thread-code-block')!
    await waitFor(() => expect(barWords(block)).toBe(`TypeScript ${tt('markdown.copy')}`))
    await userEvent.click(within(bar(block)).getByRole('button'))
    await waitFor(() => expect(barWords(block)).toBe(`TypeScript ${tt('markdown.copied')}`))
    const live = [...block.querySelectorAll<HTMLElement>('[role="status"], [aria-live="polite"]')]
    expect(live.some(node => words(node).includes(tt('markdown.copied'))), 'Copied is announced politely').toBe(true)
    await waitFor(() => expect(barWords(block)).toBe(`TypeScript ${tt('markdown.copy')}`), { timeout: 3_500 })
    expect(writeText).toHaveBeenCalledWith('const key = header()')
  })

  test('a fence without a language shows only Copy: never "Code", "Código" or "Code block"', () => {
    render(<Markdown text={'```\nnpm test\n```'} />)
    const block = document.querySelector('.thread-code-block')!
    expect(barWords(block)).toBe(tt('markdown.copy'))
    expect(block.textContent ?? '').not.toMatch(/\bCode\b|Código|Code block|Bloco de código/)
  })

  test('[css] the block on --surface-raised and the tokens in the --syn-* colours', async () => {
    render(<Markdown text={'```ts\n// the key\nconst key: string = header("x", 2)\n```'} />)
    const block = document.querySelector<HTMLElement>('.thread-code-block')!
    expect(usesTok(css(block, ['background', 'background-color']), 'surface-raised')).toBe(true)
    await waitFor(() => expect(block.querySelector('[class^="tk-"]')).toBeTruthy())
    for (const kind of ['keyword', 'string', 'number', 'comment']) {
      const token = block.querySelector<HTMLElement>(`.tk-${kind}`)
      expect(token, `a ${kind} token`).toBeTruthy()
      expect(/var\(\s*--syn-/.test(css(token!, 'color') ?? ''), `${kind}: a --syn-* colour`).toBe(true)
    }
  })
})

describe('A8 · tables (row 3.3)', () => {
  const TABLE = '| Endpoint | Calls | p95 ms |\n|---|---:|---:|\n| /refunds | 1204 | 81.5 |\n| /payments | 98 | 12 |'
  test('[css] no vertical rules inside, horizontal dividers in --bd-subtle', () => {
    render(<Markdown text={TABLE} />)
    const cells = [...document.querySelectorAll<HTMLElement>('td, th')]
    for (const cell of cells) for (const side of ['border-left', 'border-right', 'border-inline-start', 'border-inline-end']) {
      expect(css(cell, side) ?? 'none', `${cell.textContent}: no ${side}`).toMatch(/^(none|0|0px)(\s|$)/)
    }
    const divider = css(cells.find(cell => cell.tagName === 'TD')!, ['border-bottom', 'border-block-end'])
    expect(usesTok(divider, 'bd-subtle'), 'the divider in --bd-subtle').toBe(true)
  })

  test('[css] numbers are marked, right-aligned and tabular; text cells are not', () => {
    render(<Markdown text={TABLE} />)
    const cell = (text: string): HTMLElement => [...document.querySelectorAll<HTMLElement>('td')].find(node => node.textContent?.trim() === text)!
    for (const number of ['1204', '81.5', '12']) {
      expect(cell(number)).toHaveAttribute('data-numeric', 'true')
      expect(css(cell(number), 'text-align'), `${number} right`).toBe('right')
      expect(css(cell(number), 'font-variant-numeric') ?? '', `${number} tabular`).toContain('tabular-nums')
    }
    expect(cell('/refunds')).not.toHaveAttribute('data-numeric', 'true')
    const region = screen.getByRole('region', { name: tt('markdown.table') })
    expect(css(region, 'overflow-x'), 'scrolls sideways inside its own region').toBe('auto')
    expect(region, 'the table region is the md-table hook BRD-25.table.vrule measures').toHaveAttribute('data-ui', 'md-table')
  })

  test('turns BRD-25.table.vrule to enforced (SOURCE-TEXT check of the target data, marked)', () => {
    expect(notEnforced(['BRD-25.table.vrule'])).toEqual([])
  })
})

describe('A8 · maths, images and the space around rich blocks (row 3.5, "Espaços")', () => {
  test('[css] an image has a soft border and at most 480 px', () => {
    render(<Markdown text={'![shot](data:image/png;base64,iVBORw0KGgo=)'} />)
    const image = screen.getByRole('img', { name: 'shot' })
    expect(px(css(image, 'max-height'))).toBe(480)
    expect(css(image, ['border', 'border-color']) ?? '', 'a border').toMatch(/var\(--bd-/)
  })

  test('[css] 16 px between prose and a code block or a table', () => {
    render(<Markdown text={'Before.\n\n```\nx\n```\n\nBetween.\n\n| a | b |\n|---|---|\n| 1 | 2 |'} />)
    const code = document.querySelector<HTMLElement>('.thread-code-block')!
    const table = screen.getByRole('region', { name: tt('markdown.table') })
    for (const [name, block] of [['code', code], ['table', table]] as const) {
      const margin = css(block, ['margin', 'margin-block', 'margin-top', 'margin-block-start']) ?? ''
      expect(px(margin.split(/\s+/)[0]), `${name}: 16 px from the prose`).toBe(16)
    }
  })
})

describe('A8 · a diagram still arriving, and one that cannot be drawn (rows 4.2 and 4.3)', () => {
  const PARTIAL = '```mermaid\nflowchart LR\n  A[Refund] --> B{Seen'
  const BROKEN = '```mermaid\nflowchart LR\n  A[Refund] --> B{Seen\n```'
  test.each(['en', 'pt-BR'] as const)('(%s) while the answer streams: "Building the diagram…" with the partial code, and no error', async locale => {
    await changeLanguage(locale)
    render(<Markdown streaming text={PARTIAL} />)
    await new Promise(resolve => setTimeout(resolve, 600))
    const block = document.querySelector<HTMLElement>('[data-testid="thread-diagram"]')!
    expect(block, 'the diagram block').toBeTruthy()
    expect(words(block)).toContain(BUILDING[locale])
    expect(words(block)).toContain('A[Refund] --> B{Seen')
    expect(words(block)).not.toContain(CANNOT[locale])
  })

  test.each(['en', 'pt-BR'] as const)('(%s) finished and invalid: one line on top of the block, the code still readable and copyable', async locale => {
    await changeLanguage(locale)
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<Markdown text={BROKEN} />)
    const notice = await screen.findByText(CANNOT[locale], {}, { timeout: 3_000 })
    const block = document.querySelector<HTMLElement>('[data-testid="thread-diagram"]')!
    expect(block.contains(notice)).toBe(true)
    expect(notice.closest('[role="note"]'), 'a note, not an alarm').toBeTruthy()
    expect(block.querySelector('pre code')?.textContent).toContain('A[Refund] --> B{Seen')
    await userEvent.click(within(bar(block)).getAllByRole('button').at(-1)!)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('flowchart LR\n  A[Refund] --> B{Seen'))
  })

  test('adds the two diagram lines to both catalogs', () => {
    expect(pairKey('thread', BUILDING.en, BUILDING['pt-BR'])).not.toBe('')
    expect(pairKey('thread', CANNOT.en, CANNOT['pt-BR'])).not.toBe('')
  })
})
