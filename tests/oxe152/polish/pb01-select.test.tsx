// Frozen acceptance test for 1.5.2 Polimento · Componentes base (Jira OXE-192, PB-01·1, CA-1 to CA-3). Written by the
// planner; the executor must not edit it. Item: oxespace-ux-ag/POLISH-01-componentes-base.md #1, adjusted by MARCA (the
// chevron in SVG; the value keeps 13 px, it is content, not a control label).
// Contract (src/ui/Field.tsx Select, src/ui/Field.module.css): the chevron is an inline <svg> beside the native <select>,
// a direct child of the select's parent element, aria-hidden, 12 px (width/height 12, as lucide's size={12} draws it, or
// 12px in CSS), drawn with stroke currentColor and pointer-events none; .select has no background-image (forced colours
// drop it, which is the defect). In forced colours nothing hides the chevron and it keeps currentColor, the system
// text colour. The value stays at --fs-sm. The label still names the select. The built app is checked with emulated
// forced colours by pb-01-1.spec.ts.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { Select } from '../../../src/ui/Field'
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
// ---- SOURCE-TEXT (rigor: source-assertion): the stylesheets' rules matched against the RENDERED nodes ----
// jsdom has no layout and no cascade, so the cases named "[css]" read the src/ui and DesignSystem CSS Modules and
// src/styles/forced-colors.css, keep the rules whose selector matches the rendered node (in a state: at rest, under the
// pointer, focused; on a pseudo-element; in forced colours) and take the winning declaration (important, then
// unlayered over @layer, then specificity, then source order). Media queries other than forced-colors are left out.
// The end-to-end spec of the card measures the same thing in the built app.
interface PbRule { bare: string; states: string[]; pseudo: string; forced: boolean; layered: boolean; spec: number; order: number; decls: Array<[string, string, boolean]> }
/** rest; under the pointer; focused (the node or a node inside it); `within`: only a node inside it is focused. */
type PbState = 'rest' | 'hover' | 'focus' | 'within'
const pbUi = import.meta.glob('../../../src/ui/*.module.css', { eager: true }) as Record<string, { default: Record<string, string> }>
const pbDs = import.meta.glob('../../../src/components/DesignSystem/*.module.css', { eager: true }) as Record<string, { default: Record<string, string> }>
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
  ...Object.entries(pbDs).flatMap(([path, mod]) => pbParse(`src/components/DesignSystem/${path.split('/').pop()}`, mod.default)),
  ...pbParse('src/styles/forced-colors.css')
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
afterEach(() => cleanup())
const OPTIONS = [{ value: 'en', label: 'English' }, { value: 'pt-BR', label: 'Português (Brasil)' }]
/** The chevron next to the select: an svg that is a direct child of the select's parent. */
function chevronOf(select: HTMLElement): SVGSVGElement | null {
  return [...(select.parentElement?.children ?? [])].find((node): node is SVGSVGElement => node.tagName.toLowerCase() === 'svg') ?? null
}
const pointerNone = (svg: Element): boolean => svg.getAttribute('pointer-events') === 'none' || (svg as unknown as HTMLElement).style?.pointerEvents === 'none' || css(svg, 'pointer-events') === 'none'
const twelve = (svg: Element): boolean => (svg.getAttribute('width') === '12' && svg.getAttribute('height') === '12') || (px(css(svg, ['width', 'inline-size'])) === 12 && px(css(svg, ['height', 'block-size'])) === 12)

describe('PB-01·1 · the Select chevron is an SVG', () => {
  test('the chevron is an inline 12 px svg with stroke currentColor and pointer-events none, hidden from assistive technology', () => {
    render(<Select label="Language" options={OPTIONS} defaultValue="en" />)
    const select = screen.getByLabelText('Language')
    expect(select.tagName).toBe('SELECT')
    const chevron = chevronOf(select)
    expect(chevron, 'an <svg> next to the <select>').not.toBeNull()
    expect(chevron!.getAttribute('aria-hidden')).toBe('true')
    expect(twelve(chevron!), '12 px').toBe(true)
    expect(chevron!.getAttribute('stroke') ?? css(chevron!, 'stroke')).toBe('currentColor')
    expect(pointerNone(chevron!), 'pointer-events none: a click on the chevron opens the select').toBe(true)
  })

  test('[css] .select draws no background-image, at rest and in forced colours', () => {
    render(<Select label="Language" options={OPTIONS} defaultValue="en" />)
    const select = screen.getByLabelText('Language')
    for (const forced of [false, true]) {
      const image = css(select, 'background-image', { forced })
      expect(image === undefined || image === 'none', `background-image ${image}`).toBe(true)
      expect(css(select, 'background', { forced }) ?? '', 'no gradient in the background shorthand').not.toMatch(/gradient/)
    }
    expect(cssAll(select, 'background-image').filter(value => /gradient|url\(/.test(value))).toEqual([])
  })

  test('[css] in forced colours the chevron stays shown in the system text colour (currentColor)', () => {
    render(<Select label="Language" options={OPTIONS} defaultValue="en" />)
    const chevron = chevronOf(screen.getByLabelText('Language'))
    expect(chevron).not.toBeNull()
    const forced = { forced: true }
    expect(css(chevron!, 'display', forced) ?? 'inline').not.toBe('none')
    expect(css(chevron!, 'visibility', forced) ?? 'visible').not.toBe('hidden')
    expect(css(chevron!, 'opacity', forced) ?? '1').not.toBe('0')
    expect(chevron!.getAttribute('stroke') ?? css(chevron!, 'stroke', forced)).toBe('currentColor')
    const color = css(chevron!, 'color', forced)
    expect(color === undefined || /^(currentColor|inherit|CanvasText|FieldText|ButtonText)$/.test(color), `color ${color}`).toBe(true)
  })

  test('[css] the value keeps --fs-sm (13 px), with no font change', () => {
    render(<Select label="Language" options={OPTIONS} defaultValue="en" />)
    expect(usesTok(css(screen.getByLabelText('Language'), 'font-size'), 'fs-sm')).toBe(true)
  })
})
