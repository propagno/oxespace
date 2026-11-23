// Frozen acceptance test for 1.5.2 Polimento · OxeQuery (Jira OXE-229, PQ-07·16, CA-1 to CA-4, the panel). Written by
// the planner; the executor must not edit it. Item: oxespace-ux-ag/POLISH-07-oxequery.md #16, approved as written by MARCA.
// It needs the backend task's audit.list answer { entries, hasMore, cursor } and entries with actorLabel.
// Contract: a failed request's Result cell (row data-outcome="error") is --intent-danger-fg at --weight-medium; the
// Agent cell shows actorLabel, with the raw actor beside it in <code> (--font-mono, --fs-2xs), or only the raw actor
// when actorLabel is null; Refresh is a src/ui Button of the segment's height (medium: no data-size); and when
// hasMore the panel offers activity.loadMore (en "Load more", pt-BR "Carregar mais", a new key in both catalogs)
// which asks audit.list again with the cursor and appends the next page.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ActivityPanel } from '../../../src/components/OxeQuery/ActivityPanel'
import { installFakeOxeQuery, type FakeOxeQuery } from '../../helpers/oxequery-api'
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
const entry = (id: number, change: Record<string, unknown> = {}) => ({
  id, ts: 1_700_000_000_000 - id, actor: 'pane:p1', actorLabel: 'Claude · 2', connectionId: 'c1', connectionName: 'shop', engine: 'postgres', environment: 'dev',
  tool: 'oxespace_db_query', textHash: null, text: `SELECT ${id}`, decision: 'auto', outcome: 'ok', rows: 1, durationMs: 2, errorCode: null, ...change
})
let api: FakeOxeQuery
beforeEach(() => {
  api = installFakeOxeQuery()
  api.on('audit.list', (input: Record<string, unknown>) => input.cursor === 'next'
    ? { entries: [entry(3)], hasMore: false, cursor: null }
    : { entries: [entry(1, { outcome: 'error', errorCode: 'timeout' }), entry(2, { actor: 'thread:abc', actorLabel: null })], hasMore: true, cursor: 'next' })
})
afterEach(() => cleanup())

async function panel() {
  render(<ActivityPanel active />)
  await screen.findByText('SELECT 1')
  return screen.getByRole('region', { name: cat('activity.label') })
}
const rowOf = (text: string): HTMLElement => screen.getByText(text).closest('tr')!
const cellOf = (row: HTMLElement, column: string): HTMLElement => {
  const headers = [...row.closest('table')!.querySelectorAll('th')].map(th => th.textContent)
  return row.querySelectorAll('td')[headers.indexOf(cat(`activity.column.${column}`))] as HTMLElement
}

describe('PQ-07·16 · Agent activity: failures in danger, who acted by name, more than 200', () => {
  test('[css] a failed result is --intent-danger-fg at --weight-medium; a good one is not', async () => {
    await panel()
    const failed = cellOf(rowOf('SELECT 1'), 'result')
    const node = failed.firstElementChild ?? failed
    expect(usesTok(css(node, 'color'), 'intent-danger-fg')).toBe(true)
    expect(css(node, 'font-weight')).toBe('var(--weight-medium)')
    const ok = cellOf(rowOf('SELECT 2'), 'result')
    expect(usesTok(css(ok.firstElementChild ?? ok, 'color'), 'intent-danger-fg')).toBe(false)
  })

  test('[css] the Agent column names who acted, with the raw id beside it in mono --fs-2xs', async () => {
    await panel()
    const named = cellOf(rowOf('SELECT 1'), 'agent')
    expect(named.textContent).toContain('Claude · 2')
    const raw = within(named).getByText('pane:p1')
    expect(raw.tagName).toBe('CODE')
    expect(usesTok(css(raw, 'font-family'), 'font-mono')).toBe(true)
    expect(css(raw, 'font-size')).toBe(`var(${tok('fs-2xs')})`)
    expect(cellOf(rowOf('SELECT 2'), 'agent').textContent?.trim()).toBe('thread:abc')
  })

  test('Refresh is a medium src/ui Button, the height of the filter segment beside it', async () => {
    const region = await panel()
    const refresh = within(region).getByRole('button', { name: cat('common.refresh') })
    expect(refresh).toHaveAttribute('data-ui', 'button')
    expect(refresh).not.toHaveAttribute('data-size')
  })

  test('with more entries, Load more asks again with the cursor and appends the next page', async () => {
    const region = await panel()
    fireEvent.click(within(region).getByRole('button', { name: cat('activity.loadMore') }))
    await screen.findByText('SELECT 3')
    expect(api.callsOf('audit.list').at(-1)).toMatchObject({ cursor: 'next' })
    expect(screen.getByText('SELECT 1')).toBeInTheDocument()
    await waitFor(() => expect(within(region).queryByRole('button', { name: cat('activity.loadMore') })).toBeNull())
    expect(cat('activity.loadMore', {}, 'pt-BR')).toBe('Carregar mais')
  })
})
