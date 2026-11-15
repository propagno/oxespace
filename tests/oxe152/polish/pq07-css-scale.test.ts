// Frozen acceptance test for 1.5.2 Polimento · OxeQuery (Jira OXE-217, PQ-07·4, CA-1 to CA-3). Written by the planner;
// the executor must not edit it. Item: oxespace-ux-ag/POLISH-07-oxequery.md #4, approved as written by MARCA.
// SOURCE-TEXT (marked, as the card says): this file reads OxeQuery.css and tokens.generated.css. Contract: no font-size
// (nor `font` shorthand) in OxeQuery.css is a px literal: 10/11 px become var(--fs-2xs), 12 px var(--fs-xs) (any type
// token is fine, never a px or rem literal); no border-radius of 3 or 4 px (var(--radius-sm); .oq-plan-share
// var(--radius-full)); and the engine tag, set in --fs-2xs, is 12 px in the comfortable density. The e2e spec
// pq-07-4 measures computed sizes in the built app.
import { describe, expect, test } from 'vitest'
// ---- catalog strings (inlined in each frozen file so every task's PR stands alone) ----
import { readFileSync as pqReadFile } from 'node:fs'
import { join as pqJoin } from 'node:path'

const pqRead = (rel: string): string => pqReadFile(pqJoin(process.cwd(), rel), 'utf8')
const pqCatalogs: Record<string, unknown> = {}
/** The OxeQuery catalog text of a key, so elements are found by the string the person reads. A missing key fails loudly. */
function cat(key: string, vars: Record<string, string | number> = {}, lang: 'en' | 'pt-BR' = 'en'): string {
  pqCatalogs[lang] ??= JSON.parse(pqRead(`shared/locales/${lang}/oxequery.json`))
  let node: unknown = pqCatalogs[lang]
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the ${lang} oxequery catalog has no key ${key}`)
  return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? `{{${name}}}`))
}
// ---- SOURCE-TEXT: the stylesheets' rules matched against the RENDERED nodes (jsdom has no layout and no cascade) ----
// The cases named "[css]" read OxeQuery.css, the OxeQuery and src/ui CSS Modules and forced-colors.css, keep the rules
// whose selector matches the rendered node (in a state: at rest, under the pointer, focused; or in forced colours) and
// take the winning declaration (important, then unlayered over @layer, then specificity, then source order). They are
// marked as source-text checks; the end-to-end spec of the card measures the same thing in the built app.
interface PqRule { bare: string; states: string[]; forced: boolean; layered: boolean; spec: number; order: number; decls: Array<[string, string, boolean]> }
/** rest; under the pointer; focused (the node or a node inside it); `within`: only a node inside it is focused. */
type PqState = 'rest' | 'hover' | 'focus' | 'within'
const pqUi = import.meta.glob('../../../src/ui/*.module.css', { eager: true }) as Record<string, { default: Record<string, string> }>
const pqOq = import.meta.glob('../../../src/components/OxeQuery/*.module.css', { eager: true }) as Record<string, { default: Record<string, string> }>
const PQ_STATE = /:(hover|focus-visible|focus-within|focus)(?![\w-])/g
function pqSplit(text: string, sep: string): string[] {
  const out: string[] = []; let depth = 0, start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--
    else if (c === sep && depth === 0) { out.push(text.slice(start, i)); start = i + 1 }
  }
  out.push(text.slice(start)); return out.map(s => s.trim()).filter(Boolean)
}
function pqSpec(selector: string): number {
  const s = selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '')
  const ids = (s.match(/#[\w-]+/g) ?? []).length
  const cls = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!not\(|is\(|has\(|where\()[\w-]+/g) ?? []).length
  const types = (s.match(/(^|[\s>+~(,])[a-zA-Z][\w-]*/g) ?? []).length
  return ids * 10000 + cls * 100 + types
}
let pqOrder = 0
function pqParse(rel: string, classes?: Record<string, string>): PqRule[] {
  const rules: PqRule[] = []
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
        else if (/^@(media|container|supports)\b/.test(head)) walk(body, forced || /forced-colors:\s*active/.test(head), layered)
        continue
      }
      const decls = pqSplit(body, ';').map(item => {
        const colon = item.indexOf(':')
        const value = item.slice(colon + 1).trim()
        return [item.slice(0, colon).trim().toLowerCase(), value.replace(/\s*!important$/, ''), /!important$/.test(value)] as [string, string, boolean]
      }).filter(([name]) => name)
      for (const raw of pqSplit(head, ',')) {
        if (raw.includes('::')) continue
        const mapped = classes ? raw.replace(/\.(-?[_a-zA-Z][\w-]*)/g, (whole, name: string) => classes[name] ? `.${classes[name]}` : whole) : raw
        const states = [...mapped.matchAll(PQ_STATE)].map(m => m[1])
        const bare = mapped.replace(/(^|[\s>+~(])(?=:(hover|focus-visible|focus-within|focus)(?![\w-]))/g, '$1*').replace(PQ_STATE, '').trim()
        rules.push({ bare, states, forced, layered, spec: pqSpec(mapped), order: pqOrder++, decls })
      }
    }
  }
  walk(pqRead(rel).replace(/\/\*[\s\S]*?\*\//g, ''), false, false)
  return rules
}
const PQ_RULES: PqRule[] = [
  ...Object.entries(pqUi).flatMap(([path, mod]) => pqParse(`src/ui/${path.split('/').pop()}`, mod.default)),
  ...Object.entries(pqOq).flatMap(([path, mod]) => pqParse(`src/components/OxeQuery/${path.split('/').pop()}`, mod.default)),
  ...pqParse('src/components/OxeQuery/OxeQuery.css'),
  ...pqParse('src/styles/forced-colors.css')
]
const PQ_ALLOWED: Record<PqState, string[]> = { rest: [], hover: ['hover'], focus: ['focus', 'focus-visible', 'focus-within'], within: ['focus-within'] }
/** The value a node takes for a property from the matched rules (and its inline style), or undefined when none sets it. */
function css(node: Element, prop: string, { state = 'rest', forced = false }: { state?: PqState; forced?: boolean } = {}): string | undefined {
  const hits: Array<{ value: string; important: boolean; layered: boolean; spec: number; order: number }> = []
  for (const rule of PQ_RULES) {
    if (rule.forced && !forced) continue
    if (!rule.states.every(s => PQ_ALLOWED[state].includes(s))) continue
    let ok: boolean
    try { ok = node.matches(rule.bare || '*') } catch { ok = false }
    if (!ok) continue
    for (const [name, value, important] of rule.decls) if (name === prop) hits.push({ value, important, layered: rule.layered, spec: rule.spec, order: rule.order })
  }
  const inline = (node as HTMLElement).style?.getPropertyValue(prop)
  if (inline) hits.push({ value: inline, important: false, layered: false, spec: 1e9, order: 1e9 })
  hits.sort((a, b) => Number(a.important) - Number(b.important) || Number(b.layered) - Number(a.layered) || a.spec - b.spec || a.order - b.order)
  return hits.at(-1)?.value
}
const PQ_TOKENS = pqRead('src/styles/tokens.generated.css')
const PQ_LONG: Record<string, string> = { fs: 'text', tx: 'text', bd: 'border' }
/** A generated token by its short name (--fs-*, --tx-*, --bd-* after #845); the long name while main still emits it. */
function tok(name: string): string {
  if (PQ_TOKENS.includes(`--${name}:`)) return `--${name}`
  const [head, ...rest] = name.split('-')
  return PQ_LONG[head] ? `--${PQ_LONG[head]}-${rest.join('-')}` : `--${name}`
}
/** The value is that token (var(--x) or var(--x, fallback)). */
const usesTok = (value: string | undefined, name: string): boolean => !!value && new RegExp(`var\\(\\s*${tok(name)}\\s*[,)]`).test(value)
const SHEET = pqRead('src/components/OxeQuery/OxeQuery.css').replace(/\/\*[\s\S]*?\*\//g, '')
/** Every `selector { … prop: value … }` of the sheet with that property, inside @media/@container blocks too. */
function declarations(prop: string): Array<{ selector: string; value: string }> {
  const found: Array<{ selector: string; value: string }> = []
  for (const match of SHEET.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const item of match[2].split(';')) {
      const colon = item.indexOf(':')
      if (colon > 0 && item.slice(0, colon).trim() === prop) found.push({ selector: match[1].trim().replace(/\s+/g, ' '), value: item.slice(colon + 1).trim() })
    }
  }
  return found
}
/** A token's value in a block of tokens.generated.css (`:root` or the comfortable density). */
function tokenValue(name: string, block: 'base' | 'comfortable'): string | undefined {
  const at = block === 'base' ? PQ_TOKENS : PQ_TOKENS.slice(PQ_TOKENS.indexOf(":root[data-density='comfortable']"))
  return new RegExp(`${name}:\\s*([^;]+);`).exec(at)?.[1].trim()
}

describe('PQ-07·4 · OxeQuery type sizes from tokens, radii on the scale', () => {
  test('[source] no font-size in OxeQuery.css is a px or rem literal (10, 11 and 12 px are tokens now)', () => {
    const literal = declarations('font-size').filter(({ value }) => /\d(px|rem)\b/.test(value) && !/var\(--/.test(value))
    expect(literal.map(({ selector, value }) => `${selector}: ${value}`)).toEqual([])
  })

  test('[source] the three rules under the 11 px floor (engine tag, header sort mark, toolbar kbd) are set in a type token', () => {
    for (const selector of ['.oq-engine-tag', '.oq-grid-header b', '.oq-editor-toolbar kbd']) {
      const sizes = declarations('font-size').filter(item => item.selector.split(',').map(s => s.trim()).includes(selector)).map(item => item.value)
      expect(sizes.length, selector).toBeGreaterThan(0)
      for (const size of sizes) expect(size, selector).toMatch(new RegExp(`^var\\((${tok('fs-2xs')}|${tok('fs-xs')}|${tok('fs-sm')})\\)$`))
    }
  })

  test('[source] no border-radius of 3 or 4 px; the plan share bar is a full radius', () => {
    const off = declarations('border-radius').filter(({ value }) => /(^|\s)[34]px\b/.test(value))
    expect(off.map(({ selector, value }) => `${selector}: ${value}`)).toEqual([])
    const share = declarations('border-radius').filter(item => item.selector === '.oq-plan-share').map(item => item.value)
    expect(share.at(-1)).toBe('var(--radius-full)')
  })

  test('[source] in the comfortable density the engine tag is 12 px: its size is --fs-2xs, which comfortable sets to 12 px', () => {
    const sizes = declarations('font-size').filter(item => item.selector.split(',').map(s => s.trim()).includes('.oq-engine-tag')).map(item => item.value)
    expect(sizes.at(-1)).toBe(`var(${tok('fs-2xs')})`)
    expect(tokenValue(tok('fs-2xs'), 'comfortable')).toBe('12px')
  })
})
