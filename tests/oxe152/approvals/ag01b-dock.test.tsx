// Frozen acceptance test for 1.5.2 Polimento · Aprovações (Jira OXE-180, comment of 15/11: POLISH-02 #9, MARCA "vereditos
// do segundo lote"), the notice dock. Written by the planner; the executor must not edit it. Today the approval notice
// sits at bottom --space-4 with z-index 400: it covers 8 px of the status bar and overlaps the toast stack at the same
// z-index, in the warning colours. Asked: ONE vertical dock; the approval notice just above the status bar (bottom
// calc(var(--statusbar-height) + var(--space-3))) and the toast stack above the notice (gap --space-2), the notice in
// --attn-border / --attn-fg with --radius-sm.
// Contract (src/components/Approvals/Approvals.module.css, src/ui/ToastStack.tsx and its rule in src/ui/Display.module.css):
// the notice root ([data-ui=approval-toast], the hook of the notice task, T3) has bottom calc(var(--statusbar-height) + var(--space-3)), a
// border in var(--attn-border), border-radius var(--radius-sm) and no --intent-warning-* colour; the stack's position
// rule moves it above the notice while one is shown (how is the task's choice: a shared dock container, or a variable
// the notice sets), measured in the built app by e2e/polish/ag01b-dock.spec.ts; with no notice the stack stays where it
// is today (bottom calc(var(--statusbar-height) + var(--space-3))).
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApprovalToast } from '../../../src/components/Approvals/ApprovalToast'
import ToastStack from '../../../src/ui/ToastStack'
// ---- repository text and catalog strings (inlined in each frozen file so every task's PR stands alone) ----
import { readFileSync as pbReadFile } from 'node:fs'
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
// ---- SOURCE-TEXT (rigor: source-assertion): the stylesheets' rules matched against the RENDERED nodes ----
// jsdom has no layout and no cascade, so the cases named "[css]" read the src/ui, Approvals and Activity CSS Modules, keep the rules whose selector matches the rendered node (in a state: at rest, under the
// pointer, focused; on a pseudo-element; in forced colours) and take the winning declaration (important, then
// unlayered over @layer, then specificity, then source order). Media queries other than forced-colors are left out.
// The end-to-end spec of the card measures the same thing in the built app.
interface PbRule { bare: string; states: string[]; pseudo: string; forced: boolean; layered: boolean; spec: number; order: number; decls: Array<[string, string, boolean]> }
/** rest; under the pointer; focused (the node or a node inside it); `within`: only a node inside it is focused. */
type PbState = 'rest' | 'hover' | 'focus' | 'within'
const pbUi = import.meta.glob('../../../src/ui/*.module.css', { eager: true }) as Record<string, { default: Record<string, string> }>
const pbAp = import.meta.glob('../../../src/components/Approvals/*.module.css', { eager: true }) as Record<string, { default: Record<string, string> }>
const pbAc = import.meta.glob('../../../src/components/Activity/*.module.css', { eager: true }) as Record<string, { default: Record<string, string> }>
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
  ...Object.entries(pbAp).flatMap(([path, mod]) => pbParse(`src/components/Approvals/${path.split('/').pop()}`, mod.default)),
  ...Object.entries(pbAc).flatMap(([path, mod]) => pbParse(`src/components/Activity/${path.split('/').pop()}`, mod.default))
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
const IMPACT = { why: 'Runs the tests.', where: 'shop', affects: { count: 2, unit: 'files' }, reversible: true, undoHow: 'checkpoint', risk: 'low', kind: 'command', text: 'npm test', lang: 'shell' }
const REQUEST = { id: 'r1', nativeId: 'n-r1', nativeMethod: 'can_use_tool:Bash', kind: 'approval', title: 'Run the tests', toolName: 'Bash', command: 'npm test', generation: 1, createdAt: 1, state: 'pending', availableDecisions: ['accept', 'decline'], impact: IMPACT }
afterEach(() => cleanup())

function notice(): HTMLElement {
  const Toast = ApprovalToast as unknown as (p: Record<string, unknown>) => JSX.Element | null
  render(<Toast request={REQUEST} agent="Claude" conversation="Checkout fix" onRespond={vi.fn(async () => undefined)} onSeeImpact={vi.fn()} onOpenConversation={vi.fn()} onClose={vi.fn()} />)
  return document.querySelector<HTMLElement>('[data-ui="approval-toast"]') ?? document.querySelector<HTMLElement>('[role="status"][aria-live="polite"]')!
}

describe('POLISH-02 #9 · one notice dock above the status bar', () => {
  test('[css] the approval notice sits --space-3 above the status bar, not over it', () => {
    const root = notice()
    const bottom = css(root, ['bottom', 'inset-block-end', 'inset'])
    expect(bottom, 'the notice has a bottom').toBeTruthy()
    expect(px(bottom)).toBe(px('calc(var(--statusbar-height) + var(--space-3))'))
    expect(px(bottom, 'comfortable')).toBe(px('calc(var(--statusbar-height) + var(--space-3))', 'comfortable'))
  })

  test('[css] the notice is in --attn-border with --radius-sm, never the warning colours', () => {
    const root = notice()
    expect(usesTok(css(root, ['border-color', 'border']), 'attn-border'), 'border var(--attn-border)').toBe(true)
    expect(usesTok(css(root, 'border-radius'), 'radius-sm'), 'border-radius var(--radius-sm)').toBe(true)
    for (const prop of ['border', 'border-color', 'background', 'background-color', 'color']) {
      expect(/--intent-warning/.test(css(root, prop) ?? ''), `${prop} is not a warning colour`).toBe(false)
    }
  })

  test('[css] with no notice the toast stack keeps its place above the status bar', () => {
    render(<ToastStack />)
    const region = document.querySelector<HTMLElement>('section[aria-live="polite"]')!
    expect(px(css(region, ['bottom', 'inset-block-end', 'inset']))).toBe(px('calc(var(--statusbar-height) + var(--space-3))'))
  })
})
