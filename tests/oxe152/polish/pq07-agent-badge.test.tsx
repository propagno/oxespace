// Frozen acceptance test for 1.5.2 Polimento · OxeQuery (Jira OXE-220, PQ-07·7, CA-1, CA-2 and CA-4). Written by the
// planner; the executor must not edit it. Item: oxespace-ux-ag/POLISH-07-oxequery.md #7, approved as written by MARCA.
// window.oxe is built by the REAL preload (tests/acceptance/f4/crf4-8-preload.ts) over a fake main.
// Contract: a badge with an agent waiting (data-tone="attn", the sun) is drawn in the attention amber, --attn-border,
// --attn-bg and --attn-fg (never the warning intent); a click opens OxeQuery's own Activity tab
// (useOxeQueryStore.openActivity: the active tab becomes 'activity'), not Settings > Activity; and while mounted the
// badge listens to window.oxe.agentActivity.onChanged (backend task) and asks badge({ connectionId }) again on a change
// for its connection (or one without a connection), updating today and waiting in place, without a remount.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AgentActivityBadge } from '../../../src/components/OxeQuery/AgentActivityBadge'
import { useOxeQueryStore } from '../../../src/components/OxeQuery/oxequery.store'
import { useUIStore } from '../../../src/store/ui.store'
import { preloadOxe } from '../../acceptance/f4/crf4-8-preload'
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
let state = { today: 1, waiting: false }
let fake: ReturnType<typeof preloadOxe>
beforeEach(() => {
  state = { today: 1, waiting: false }
  fake = preloadOxe({ 'agentActivity.badge': () => ({ ...state }) })
  useOxeQueryStore.setState({ tabs: [], activeTab: '' })
})
afterEach(() => cleanup())

const badgeCalls = (): number => fake.invoked.filter(([key]) => key === 'agentActivity.badge').length
const label = (count: number): string => cat(count === 1 ? 'agentActivity.badge_one' : 'agentActivity.badge_other', { count })

describe('PQ-07·7 · AgentActivityBadge in the attention amber, opening Activity, live', () => {
  test('[css] with an agent waiting the badge uses --attn-border, --attn-bg and --attn-fg', async () => {
    state = { today: 2, waiting: true }
    render(<AgentActivityBadge connectionId="c1" />)
    const badge = await screen.findByRole('button', { name: label(2) })
    expect(badge).toHaveAttribute('data-tone', 'attn')
    expect(usesTok(css(badge, 'border-color') ?? css(badge, 'border'), 'attn-border')).toBe(true)
    expect(usesTok(css(badge, 'background') ?? css(badge, 'background-color'), 'attn-bg')).toBe(true)
    expect(usesTok(css(badge, 'color'), 'attn-fg')).toBe(true)
  })

  test('a click opens the Activity tab of OxeQuery, not Settings', async () => {
    const openSettingsPage = vi.fn()
    useUIStore.setState({ openSettingsPage })
    render(<AgentActivityBadge connectionId="c1" />)
    fireEvent.click(await screen.findByRole('button', { name: label(1) }))
    expect(useOxeQueryStore.getState().activeTab).toBe('activity')
    expect(useOxeQueryStore.getState().tabs.some(tab => tab.kind === 'activity')).toBe(true)
    expect(openSettingsPage).not.toHaveBeenCalled()
  })

  test('a change pushed by main makes the mounted badge ask again and turn to waiting in place', async () => {
    render(<AgentActivityBadge connectionId="c1" />)
    const before = await screen.findByRole('button', { name: label(1) })
    const asked = badgeCalls()
    state = { today: 2, waiting: true }
    await act(async () => { fake.emit('agentActivity.changed', { connectionId: 'c1' }) })
    await waitFor(() => expect(screen.getByRole('button', { name: label(2) })).toHaveAttribute('data-tone', 'attn'))
    expect(badgeCalls()).toBeGreaterThan(asked)
    expect(screen.getByRole('button', { name: label(2) })).toBe(before)
  })

  test('a change for another connection does not make it ask again', async () => {
    render(<AgentActivityBadge connectionId="c1" />)
    await screen.findByRole('button', { name: label(1) })
    const asked = badgeCalls()
    await act(async () => { fake.emit('agentActivity.changed', { connectionId: 'c2' }) })
    expect(badgeCalls()).toBe(asked)
  })
})
