// Frozen acceptance test for 1.5.2 Polimento · Aprovações (Jira OXE-181, AG-09, CA-1, CA-2, CA-3 and CA-5), the Activity
// panel. Written by the planner; the executor must not edit it. MARCA (HANDOFF-3D, AG-09 verdict, with the adjustment):
// "Precisa de você" in the bell is the amber sun (StatusSignal needs-you), never the hand nor the warning orange; the
// quota notice has its own class (--intent-warning-fg and the Gauge icon); "Falhou" has its own section (StatusSignal
// failed); each entry gets the place line "{project} · OxeChat / OxeCode / OxeQuery" in --tx-muted.
// Contract (src/components/Activity/ActivityPanel.tsx, ActivityCenter.module.css, common catalogs):
// - a needs-you row leads with <StatusSignal state="needs-you"> ([data-ui=status-signal][data-state=needs-you]); no Hand
//   icon, and nothing in the row is coloured --intent-warning-*;
// - a quota row keeps the Gauge icon in a class of its own whose colour is var(--intent-warning-fg), not the needs-you
//   class;
// - failed entries are a section of their own, named activity.group.failed (en "Failed", pt-BR "Falhou", glossary §5),
//   each row with <StatusSignal state="failed">, outside "Needs you" and outside "Finished";
// - an entry with `place` (the backend task's field) shows [data-ui=activity-place] "{project} · {OxeChat|OxeCode|
//   OxeQuery}" (the mode names never translate) in --tx-muted; an entry without place (an update, a quota) has none.
// The bell itself (count, name) is ag09-activity-center.test.tsx; the built app is e2e/polish/ag09-activity-bell.spec.ts.
import { cleanup, render, screen, within } from '@testing-library/react'
import { Gauge, Hand } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ActivityPanel } from '../../../src/components/Activity/ActivityPanel'
import { changeLanguage } from '../../../src/i18n'
import { useActivityStore } from '../../../src/store/activity.store'
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
/** The path data of a lucide icon, to tell it apart from any other svg in a row. */
const shapeOf = (markup: string): string => [...markup.matchAll(/\sd="([^"]+)"/g)].map(m => m[1]).join('|')
const HAND = shapeOf(renderToStaticMarkup(<Hand />))
const GAUGE = shapeOf(renderToStaticMarkup(<Gauge />))
const svgShapes = (node: Element): string[] => [...node.querySelectorAll('svg')].map(svg => shapeOf(svg.outerHTML))

beforeEach(() => {
  useActivityStore.getState().reset()
  const { record } = useActivityStore.getState()
  record({ source: 'quota', id: 'claude', kind: 'quota', target: { type: 'quota', provider: 'claude' }, title: 'Claude quota at 90%', at: 1 })
  record({ source: 'background', id: 'job', kind: 'failed', target: { type: 'background', workspaceId: 'ws', jobId: 'job' }, title: 'Build the app', at: 2, place: { project: 'api', mode: 'code' } } as never)
  record({ source: 'code', id: 'p2', kind: 'finished', target: { type: 'pane', workspaceId: 'ws', paneId: 'p2' }, title: 'Codex', at: 3, place: { project: 'api', mode: 'code' } } as never)
  record({ source: 'mcp', id: 'warehouse', kind: 'failed', target: { type: 'mcp', serverId: 'warehouse' }, title: 'Warehouse query', at: 4, place: { project: 'warehouse', mode: 'query' } } as never)
  record({ source: 'thread', id: 't1', kind: 'needs-you', target: { type: 'thread', threadId: 't1' }, title: 'Fix the login bug', detail: 'Run npm test', at: 5, place: { project: 'shop', mode: 'chat' } } as never)
})
afterEach(async () => { cleanup(); await changeLanguage('en') })

const renderPanel = () => render(<ActivityPanel onClose={() => undefined} onSelectView={() => undefined} />)
const rowOf = (title: string): HTMLElement => screen.getByRole('button', { name: new RegExp(title) })

describe('AG-09 · the bell is the history, in the brand signals', () => {
  test('[css] a needs-you entry leads with the needs-you StatusSignal, not the hand nor the warning orange', () => {
    renderPanel()
    const row = rowOf('Fix the login bug')
    const signal = row.querySelector('[data-ui="status-signal"]')
    expect(signal, 'a StatusSignal leads the row').toBeTruthy()
    expect(signal).toHaveAttribute('data-state', 'needs-you')
    expect(svgShapes(row), 'no Hand icon').not.toContain(HAND)
    for (const node of [row, ...row.querySelectorAll('*')]) {
      expect(/--intent-warning/.test(css(node, 'color') ?? ''), `no warning colour on ${node.tagName.toLowerCase()}.${node.className}`).toBe(false)
    }
  })

  test('[css] a quota entry keeps the Gauge in a class of its own, --intent-warning-fg, apart from the needs-you class', () => {
    renderPanel()
    const quota = rowOf('Claude quota at 90%')
    expect(svgShapes(quota), 'the Gauge icon').toContain(GAUGE)
    const icon = [...quota.querySelectorAll('svg')].find(svg => shapeOf(svg.outerHTML) === GAUGE)!
    const holder = icon.closest('span') ?? icon
    const tinted = [icon, holder].map(node => css(node, 'color')).find(Boolean)
    expect(usesTok(tinted, 'intent-warning-fg'), 'the quota icon is var(--intent-warning-fg)').toBe(true)
    const needs = rowOf('Fix the login bug')
    const needsClasses = new Set([...needs.querySelectorAll('*')].flatMap(node => [...node.classList]))
    expect([...holder.classList].filter(name => needsClasses.has(name) && /needs/i.test(name)), 'not the needs-you class').toEqual([])
    expect(quota.querySelector('[data-state="needs-you"]'), 'a quota is not a needs-you signal').toBeNull()
  })

  test('failed entries have their own section with the failed StatusSignal, outside Needs you and Finished', () => {
    renderPanel()
    const failed = screen.getByRole('region', { name: cat('common', 'activity.group.failed') })
    expect(cat('common', 'activity.group.failed')).toBe('Failed')
    expect(failed.textContent).toContain('Build the app')
    expect(failed.textContent).toContain('Warehouse query')
    for (const row of within(failed).getAllByRole('button')) expect(row.querySelector('[data-ui="status-signal"]')).toHaveAttribute('data-state', 'failed')
    expect(screen.getByRole('region', { name: cat('common', 'activity.group.needs-you') }).textContent).not.toContain('Build the app')
    const finished = screen.queryByRole('region', { name: cat('common', 'activity.group.finished') })
    expect(finished?.textContent ?? '').not.toContain('Build the app')
    expect(finished?.textContent ?? '').toContain('Codex')
  })

  test('[css] every entry with a place says "{project} · OxeChat / OxeCode / OxeQuery" in --tx-muted; app-wide ones say none', () => {
    renderPanel()
    const placeOf = (title: string) => rowOf(title).querySelector<HTMLElement>('[data-ui="activity-place"]')
    expect(placeOf('Fix the login bug')?.textContent?.trim()).toBe('shop · OxeChat')
    expect(placeOf('Codex')?.textContent?.trim()).toBe('api · OxeCode')
    expect(placeOf('Warehouse query')?.textContent?.trim()).toBe('warehouse · OxeQuery')
    expect(usesTok(css(placeOf('Fix the login bug')!, 'color'), 'tx-muted'), '[css] --tx-muted').toBe(true)
    expect(placeOf('Claude quota at 90%')).toBeNull()
  })

  test('it reads in pt-BR: the Falhou section and the same place line', async () => {
    await changeLanguage('pt-BR')
    renderPanel()
    expect(cat('common', 'activity.group.failed', {}, 'pt-BR')).toBe('Falhou')
    expect(screen.getByRole('region', { name: 'Falhou' }).textContent).toContain('Build the app')
    expect(rowOf('Fix the login bug').querySelector('[data-ui="activity-place"]')?.textContent?.trim()).toBe('shop · OxeChat')
  })
})
