// Frozen acceptance test for 1.5.2 Polimento · Componentes base (Jira OXE-274, PB-01·15, CA-2 and CA-3). Written by the
// planner; the executor must not edit it. MARCA 15/11: a 1 px --bd-subtle hairline at the scrolled edge of the dialog
// body only while it overflows; no gradient, no motion; for every dialog.
// Contract (src/ui/Overlay.tsx, src/ui/Overlay.module.css): the Dialog body ([data-dialog-body]) says which of its edges
// hide content in data-overflow, a space-separated list: "end" while there is more below, "start" once scrolled down
// from the top; checked on mount, on scroll and on resize (a missing ResizeObserver is tolerated). Without overflow
// the attribute is absent or empty. The line is drawn by the body itself, on that edge: a 1 px solid var(--bd-subtle)
// border, or an inset 1 px box-shadow in var(--bd-subtle), or a 1 px ::before/::after in var(--bd-subtle); nothing in
// the body's rules uses a gradient, a transition or an animation. The built app is checked by pb-01-15.spec.ts.
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { Dialog } from '../../../src/ui/Overlay'
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
const shape = { scrollHeight: 400, clientHeight: 400 }
const saved = ['scrollHeight', 'clientHeight'].map(name => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const)
afterEach(() => {
  cleanup()
  for (const [name, descriptor] of saved) if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor)
})
/** Bodies report this scroll size (jsdom has no layout). */
function layout(scrollHeight: number, clientHeight: number): void {
  shape.scrollHeight = scrollHeight; shape.clientHeight = clientHeight
  for (const name of ['scrollHeight', 'clientHeight'] as const) Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get() { return shape[name] } })
}
function openDialog(): HTMLElement {
  render(<Dialog title="New table in public" size="md" onClose={() => {}} actions={{ primary: { label: 'Review SQL', onClick: () => {} } }}><p>columns</p></Dialog>)
  const body = document.querySelector<HTMLElement>('[data-dialog-body]')!
  let top = 0
  Object.defineProperty(body, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { top = value } })
  return body
}
const edges = (body: HTMLElement): string[] => (body.getAttribute('data-overflow') ?? '').split(/\s+/).filter(Boolean)
const scrollTo = (body: HTMLElement, top: number): void => { body.scrollTop = top; fireEvent.scroll(body) }

/** A 1 px --bd-subtle line on that edge of the body, in one of the three allowed drawings. */
function lineAt(body: HTMLElement, edge: 'top' | 'bottom'): boolean {
  const border = css(body, [`border-${edge}`, 'border', `border-${edge}-color`]) ?? ''
  if (/1px/.test(border) && /solid/.test(border) && usesTok(border, 'bd-subtle')) return true
  const shadow = css(body, 'box-shadow') ?? ''
  const inset = edge === 'top' ? /inset\s+0\s+1px\s+0(\s+0)?\s+var\(\s*--bd-subtle/ : /inset\s+0\s+-1px\s+0(\s+0)?\s+var\(\s*--bd-subtle/
  if (inset.test(shadow)) return true
  for (const pseudo of ['::before', '::after']) {
    const fill = css(body, ['background', 'background-color', 'border-top', 'border-bottom'], { pseudo }) ?? ''
    const height = css(body, ['height', 'block-size'], { pseudo }) ?? ''
    if (usesTok(fill, 'bd-subtle') && (/^1px$/.test(height) || /1px/.test(fill)) && css(body, edge, { pseudo }) !== undefined) return true
  }
  return false
}

describe('PB-01·15 · a hairline at the scrolled edge of the dialog body, only while it overflows', () => {
  test('a body with more below says "end", then "start" once scrolled down, and drops "end" at the bottom', async () => {
    layout(900, 400)
    const body = openDialog()
    await waitFor(() => expect(edges(body)).toContain('end'))
    expect(edges(body)).not.toContain('start')
    scrollTo(body, 200)
    await waitFor(() => expect(edges(body)).toEqual(expect.arrayContaining(['start', 'end'])))
    scrollTo(body, 500)
    await waitFor(() => expect(edges(body)).not.toContain('end'))
    expect(edges(body)).toContain('start')
  })

  test('a body that fits says nothing', async () => {
    layout(400, 400)
    const body = openDialog()
    scrollTo(body, 0)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(edges(body)).toEqual([])
  })

  test('[css] the line: 1 px --bd-subtle at the bottom while "end", at the top while "start", none without overflow', () => {
    layout(400, 400)
    const body = openDialog()
    expect(lineAt(body, 'bottom'), 'no line without overflow').toBe(false)
    body.setAttribute('data-overflow', 'end')
    expect(lineAt(body, 'bottom'), 'bottom line with more below').toBe(true)
    body.setAttribute('data-overflow', 'start')
    expect(lineAt(body, 'top'), 'top line once scrolled down').toBe(true)
  })

  test('[css] no gradient, no transition and no animation on the body', () => {
    layout(900, 400)
    const body = openDialog()
    for (const value of ['end', 'start', 'start end', '']) {
      body.setAttribute('data-overflow', value)
      for (const pseudo of ['', '::before', '::after']) {
        for (const prop of ['background', 'background-image', 'mask', 'mask-image', '-webkit-mask-image']) expect(css(body, prop, { pseudo }) ?? '', `${value} ${pseudo} ${prop}`).not.toMatch(/gradient/)
        for (const prop of ['transition', 'transition-property', 'animation', 'animation-name']) {
          const motion = css(body, prop, { pseudo })
          expect(motion === undefined || /^(none|0s)$/.test(motion), `${value} ${pseudo} ${prop}: ${motion}`).toBe(true)
        }
      }
    }
  })
})
