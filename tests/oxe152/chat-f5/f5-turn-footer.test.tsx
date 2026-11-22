// Frozen acceptance test for 1.5.2 OxeChat F5 · conversa AG-10/11, criterion A11 (task T11). Written by the planner;
// the executor must not edit it. Source: AG-11-CRITERIOS-F5.md (MARCA 15/11) rows 6.1 and 6.2 and the rules "Estados"
// (collision and technical warnings in --intent-warning-*), "Uma vez por superfície" and "Texto" (the fixed words
// "Detalhes técnicos", "Tentar de novo", "Não foi possível …"); POLISH-09 #3 (one owner of a failure in the conversation:
// no strip above the composer, no notice inside the card, no loose "Failed" line) and #4 (c) (the card's first sentence
// does not repeat its title). It takes the failure-card mould of OxeChat F4 T10 (oxc-2-conversation, BRD-19: title, message,
// actions; provider codes only under the technical disclosure; one compact line per usage window; each kind's action),
// rewritten to the fixed words. Depends on T5 (ThreadView.tsx) and T7 (ThreadFileActivity.tsx).
// Today (main 12b8e900b): a turn's changes read "Edited 3 files · …" with Undo; a failed sign-in shows the card plus a
// strip above the composer ("Sign in to Claude" with Reconnect and Retry); the card's disclosure says "Provider
// diagnostic"; Retry reads "Retry turn"; a compaction is a tool row.
// Contract:
// - 6.1: a finished turn that changed files ends with one [data-ui=turn-changes] bar: a button reading "3 files changed
//   (+42 −8)" / "3 arquivos alterados (+42 −8)" (dockChanges.files and the totals), aria-expanded, that opens the file
//   list in place with "Undo turn" / "Desfazer turno" (undoTurnChanges through /checkpoint, after today's confirm step).
//   An answer's hover actions (Copy, Quote) [css] are out of the flow (position absolute), so they move nothing.
// - 6.2 collision: CollisionChips in --intent-warning-* ([css]), in the header (frozen CR-F4-8).
// - 6.2 compaction: a contextCompaction step is one centred [data-ui=compaction-divider] "Context compacted" /
//   "Contexto compactado" (a new pair), no tool row.
// - 6.2 failure: ONE ThreadFailureCard: its title (failure.title.*), one sentence that does not repeat the title, the
//   action "Try again" / "Tentar de novo" (the retry, before Update usage for a usage failure), and a closed
//   <details> "Technical details" / "Detalhes técnicos" holding the provider's codes; a turn that changed files offers
//   undo-and-retry or retry-keeping; context → failure.compact, configuration → failure.changeConfiguration, sandbox →
//   failure.reviewPermissions; authentication → failure.reconnect and no retry. In the conversation, that card is the
//   failure's one owner: no strip above the composer (no .thread-connection-notice for it), no second "Failed" /
//   "Falhou" line outside the card.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAccountStore } from '../../../src/store/account.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { ThreadView } from '../../../src/components/Threads/ThreadView'
import { ThreadFailureCard, usageResetIn, usageWindowLabel } from '../../../src/components/Threads/ThreadFailureCard'
import { changeLanguage, i18n } from '../../../src/i18n'
import type { Workspace } from '../../../shared/types/workspace'
import type { ThreadEvent, ThreadFailure } from '../../../shared/types/thread'
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
// ---- the real ThreadView over seeded stores and a window.oxe.thread double (inlined so every task's PR stands alone) ----
// The same fixture as OxeChat F4's frozen tests (oxc-2-conversation, oxc-2b-composer): the real conversation view, its
// stores and its components; only the main process is a double, whose calls the cases read back.
vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'feat/thread', detached: false, shortSha: null, error: null }) }))

type FxStatus = 'idle' | 'running' | 'approval' | 'failed' | 'interrupted'
interface FxOptions { status?: FxStatus; thread?: Record<string, unknown>; turns?: Array<Record<string, unknown>>; pendingRequests?: unknown[]; api?: Record<string, unknown> }
/** One conversation "Auth investigation" in project "Repo" (/repo), selected, with these events; returns the double. */
function fixture(events: unknown[], options: FxOptions = {}) {
  const status = options.status ?? 'idle'
  const thread = { id: 'thread', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Auth investigation', pinned: false, status,
    nativeSessionId: 'native-1', createdAt: 1, updatedAt: 1, access: 'workspace-write', mode: 'default', ...options.thread }
  const snapshot = { thread, events, ...(options.turns ? { turns: options.turns } : {}), ...(options.pendingRequests ? { pendingRequests: options.pendingRequests } : {}) }
  const api = {
    commands: vi.fn(async () => ({ commands: [] })), projects: vi.fn(async () => ({ projects: [], unavailable: [] })), list: vi.fn(async () => [snapshot.thread]),
    create: vi.fn(async () => snapshot), read: vi.fn(async () => snapshot),
    models: vi.fn(async () => ({ defaultModel: 'native-model', models: [{ id: 'native-model', label: 'Native model', description: '', efforts: ['low', 'high'], defaultEffort: 'low' }] })),
    configure: vi.fn(async () => snapshot), send: vi.fn(async () => {}), steer: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}),
    respond: vi.fn(async () => {}), pin: vi.fn(async () => {}), onChanged: vi.fn(() => () => {}), command: vi.fn(async () => ({ kind: 'applied' })),
    turnFiles: vi.fn(async () => []), places: vi.fn(async () => ({ places: [], capped: false, refused: 0 })), onPlacesChanged: vi.fn(() => () => {}), collisions: vi.fn(async () => []),
    ...options.api
  }
  const clipboard = { writeText: vi.fn(async () => true) }
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api, clipboard, agentAccount: { read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 })) } } })
  const workspace = { id: 'ws', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useThreadStore.setState({ threads: [snapshot.thread], projects: [{ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }], snapshot, selectedId: 'thread', secondaryId: null, drafts: {}, attachments: {} } as never)
  return { snapshot, api, clipboard, workspace }
}
/** Exactly one element for the selector (a clear failure while the hook is missing). */
const one = (selector: string, root: ParentNode = document): HTMLElement => {
  const found = [...root.querySelectorAll<HTMLElement>(selector)]
  expect(found, `exactly one ${selector}`).toHaveLength(1)
  return found[0]
}
/** The visible words of a node, spaces folded. */
const words = (node: Element | null | undefined): string => (node?.textContent ?? '').replace(/\s+/g, ' ').trim()
/** A control's name: its aria-label, else its text. */
const nameOf = (el: Element): string => (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim()
const msg = (id: string, role: 'user' | 'assistant', text: string) => ({ type: 'message', id, role, text })
const tool = (id: string, name: string, over: Record<string, unknown> = {}) => ({ type: 'tool', id, name, state: 'completed', detail: '', startedAt: 1_000, completedAt: 1_300, ...over })
const done = (status: 'completed' | 'failed' | 'interrupted' = 'completed', over: Record<string, unknown> = {}) => ({ type: 'completed', status, ...over })
const tt = (key: string, options: Record<string, unknown> = {}): string => i18n.t(key, { ns: 'thread', ...options }) as string
const RETRY = { en: 'Try again', 'pt-BR': 'Tentar de novo' } as const
const TECHNICAL = { en: 'Technical details', 'pt-BR': 'Detalhes técnicos' } as const
const COMPACTED = { en: 'Context compacted', 'pt-BR': 'Contexto compactado' } as const
const UNDO_TURN = { en: 'Undo turn', 'pt-BR': 'Desfazer turno' } as const
const CHANGED = { en: '3 files changed (+42 −8)', 'pt-BR': '3 arquivos alterados (+42 −8)' } as const
const view = (f: ReturnType<typeof fixture>) => render(<ThreadView workspace={f.workspace} />)
const file = (path: string, additions: number, deletions: number) => ({ path: `/repo/${path}`, kind: 'update', source: 'native-patch', state: 'completed', additions, deletions })
const THREE = [msg('u1', 'user', 'Make refunds idempotent'), tool('e1', 'Edit', { detail: '{}', files: [file('src/pix/refund.ts', 30, 6)] }), tool('e2', 'Edit', { detail: '{}', files: [file('src/pix/client.ts', 8, 2)] }),
  tool('e3', 'Write', { detail: '{}', files: [file('tests/pix/refund.test.ts', 4, 0)] }), msg('a1', 'assistant', 'Refunds now carry an idempotency key.'), done()]
const RESETS_AT = Date.now() + 2 * 3600_000
const failed = (failure: Partial<ThreadFailure> & Pick<ThreadFailure, 'code'>): Extract<ThreadEvent, { type: 'completed' }> => ({
  type: 'completed', status: 'failed', failure: { id: `f-${failure.code}`, occurredAt: 1_790_000_000_000, message: 'The provider stopped the turn.', ...failure } as ThreadFailure })
const buttonNames = (root: HTMLElement): string[] => within(root).queryAllByRole('button').map(button => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim())

beforeEach(() => { localStorage.clear() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('A11 · the turn\'s changes and Undo turn (row 6.1)', () => {
  test.each(['en', 'pt-BR'] as const)('(%s) one bar "3 files changed (+42 −8)" that opens in place with Undo turn', async locale => {
    await changeLanguage(locale)
    const command = vi.fn(async (_id: string, text: string) => text === '/checkpoint' ? { kind: 'panel', rows: [{ label: 'Turn', turnId: 'u1', id: '/checkpoint restore c1' }] } : { kind: 'applied' })
    view(fixture(THREE, { turns: [{ id: 'u1', sequence: 1, status: 'completed', configuration: {} }], api: { command } }))
    const bar = one('[data-ui="turn-changes"]')
    const toggle = within(bar).getAllByRole('button').find(button => button.hasAttribute('aria-expanded'))!
    expect(words(toggle)).toBe(CHANGED[locale])
    if (toggle.getAttribute('aria-expanded') === 'false') await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    for (const name of ['src/pix/refund.ts', 'src/pix/client.ts', 'tests/pix/refund.test.ts']) expect(words(bar)).toContain(name)
    await userEvent.click(within(bar).getByRole('button', { name: UNDO_TURN[locale] }))
    const confirm = within(bar).queryByRole('button', { name: tt('files.confirmUndo') }) ?? within(bar).queryByRole('button', { name: tt('files.undoGroup') })
    if (confirm) await userEvent.click(confirm)
    await waitFor(() => expect(command).toHaveBeenCalledWith('thread', '/checkpoint'))
    await waitFor(() => expect(command).toHaveBeenCalledWith('thread', '/checkpoint restore c1'))
  })

  test('[css] an answer\'s hover actions sit out of the flow, so showing them moves nothing', () => {
    view(fixture(THREE, { turns: [{ id: 'u1', sequence: 1, status: 'completed', configuration: {} }] }))
    const copy = screen.getAllByRole('button', { name: new RegExp(`^(${tt('message.copyFinal')}|${tt('message.copyResponse')})`) })[0]
    const bar = copy.parentElement!
    expect(css(bar, 'position'), 'out of the flow').toBe('absolute')
  })
})

describe('A11 · collision and compaction (row 6.2)', () => {
  test('[css] the collision pill is in the warning tokens, never the sun', async () => {
    view(fixture(THREE, { turns: [{ id: 'u1', sequence: 1, status: 'completed', configuration: {} }], api: { collisions: vi.fn(async () => [{ file: 'src/pix/refund.ts', checkoutId: 'co-1', others: [{ conversationId: 'other', title: 'Login refactor' }] }]) } }))
    const chip = await screen.findByRole('button', { name: /Also edited by Login refactor/ })
    const paint = [chip, chip.parentElement!, ...chip.querySelectorAll('*')].map(node => [css(node, 'color'), css(node, ['background', 'background-color']), css(node, ['border', 'border-color'])].join(' ')).join(' ')
    expect(/--intent-warning-/.test(paint), 'warning tokens').toBe(true)
    expect(/--attn/.test(paint), 'never --attn').toBe(false)
  })

  test.each(['en', 'pt-BR'] as const)('(%s) a compaction is one centred divider "Context compacted", not a tool row', async locale => {
    await changeLanguage(locale)
    view(fixture([msg('u1', 'user', 'Go on'), tool('k1', 'contextCompaction', { detail: '' }), msg('a1', 'assistant', 'Continuing.'), tool('c9', 'Bash', { detail: 'sleep 9', state: 'running' })], { status: 'running', turns: [{ id: 'u1', sequence: 1, status: 'running', configuration: {} }] }))
    const divider = one('[data-ui="compaction-divider"]')
    expect(words(divider)).toBe(COMPACTED[locale])
    expect(divider.closest('[data-ui="step"]'), 'not a tool step').toBeNull()
    expect(css(divider, ['text-align', 'justify-content']) ?? '', '[css] centred').toMatch(/center/)
  })
})

describe('A11 · one failure card, the only owner (row 6.2, POLISH-09 #3)', () => {
  test.each(['en', 'pt-BR'] as const)('(%s) a usage failure: title, a sentence that does not repeat it, Try again before Update usage, codes only under Technical details', async locale => {
    await changeLanguage(locale)
    const { container } = render(<ThreadFailureCard latest onRetry={vi.fn()} refreshUsage={vi.fn(async () => ({ windows: [], checkedAt: 1 }))}
      event={failed({ code: 'usage', providerCode: 'usage_limit_reached', httpStatus: 429, detail: 'raw provider body 7f3a', usage: { checkedAt: 1_790_000_000_000, windows: [{ label: 'Session · 5 hours', usedPercent: 100, resetsAt: RESETS_AT }] } })} />)
    const title = screen.getByText(tt('failure.title.usage'))
    const buttons = buttonNames(container as HTMLElement)
    const retry = buttons.indexOf(RETRY[locale]), refresh = buttons.indexOf(tt('failure.refresh'))
    expect([retry >= 0, refresh >= 0, retry < refresh], `buttons ${buttons.join(' | ')}`).toEqual([true, true, true])
    for (const code of ['usage_limit_reached', 'HTTP 429', 'raw provider body 7f3a']) expect(screen.getByText(code, { exact: false }), `${code} waits under the disclosure`).not.toBeVisible()
    const disclosure = screen.getByText(TECHNICAL[locale])
    expect(disclosure.closest('details'), 'a closed <details>').not.toHaveAttribute('open')
    expect(Boolean(title.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING), 'after the title').toBe(true)
    fireEvent.click(disclosure)
    expect(screen.getByText('raw provider body 7f3a', { exact: false })).toBeVisible()
    const sentence = [...container.querySelectorAll('p')].map(node => node.textContent?.trim() ?? '').find(Boolean) ?? ''
    expect(sentence.toLowerCase(), 'the first sentence does not repeat the title (POLISH-09 #4 c)').not.toContain(tt('failure.title.usage').toLowerCase())
    const line = `${usageWindowLabel('Session · 5 hours')} · ${tt('failure.used', { percent: '100' })} · ${tt('failure.resetsIn', { time: usageResetIn(RESETS_AT) })}`
    expect([...container.querySelectorAll('*')].some(element => element.textContent?.replace(/\s+/g, ' ').trim() === line), `one line "${line}"`).toBe(true)
    expect(container.querySelectorAll('progress'), 'usage limits stay compact').toHaveLength(0)
  })

  test.each([['context', 'failure.compact', 'onCompact'], ['configuration', 'failure.changeConfiguration', 'onPermissions'], ['sandbox', 'failure.reviewPermissions', 'onPermissions']] as const)('a %s failure keeps its action (%s)', (code, key, handler) => {
    const callbacks = { onCompact: vi.fn(), onPermissions: vi.fn(), onRetry: vi.fn() }
    render(<ThreadFailureCard latest event={failed({ code })} {...callbacks} />)
    expect(screen.getByText(tt(`failure.title.${code}`))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: tt(key) }))
    expect(callbacks[handler]).toHaveBeenCalled()
  })

  test('a turn that changed files offers to undo and try again, or to try again keeping them', () => {
    const onRetry = vi.fn()
    render(<ThreadFailureCard latest hasChanges onRetry={onRetry} event={failed({ code: 'server' })} />)
    fireEvent.click(screen.getByRole('button', { name: RETRY.en }))
    expect(screen.getByRole('button', { name: tt('failure.retryKeep') })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: tt('failure.undoAndRetry') }))
    expect(onRetry).toHaveBeenCalledWith(true)
  })

  test('an authentication failure, while signed out, says to reconnect and offers no retry', () => {
    const { container } = render(<ThreadFailureCard latest onRetry={vi.fn()} event={failed({ code: 'authentication' })} />)
    expect(container).toHaveTextContent(tt('failure.reconnect'))
    expect(buttonNames(container as HTMLElement)).not.toContain(RETRY.en)
  })

  test.each(['en', 'pt-BR'] as const)('(%s) an authentication failure, once the account is connected, keeps Reconnect and Try again resends the last prompt', async locale => {
    await changeLanguage(locale)
    const events = [msg('u0', 'user', 'An earlier prompt'), msg('a0', 'assistant', 'Done.'), done(), msg('u1', 'user', 'Fix the login'), { ...failed({ code: 'authentication', message: 'Sign in again.' }), errorCode: 'authentication' }]
    const f = fixture(events, { status: 'failed', turns: [{ id: 'u0', sequence: 1, status: 'completed', configuration: {} }, { id: 'u1', sequence: 2, status: 'failed', configuration: {} }] })
    view(f)
    const card = one('[data-ui="failure-card"]')
    const again = await within(card).findByRole('button', { name: RETRY[locale] })
    expect(within(card).getByRole('button', { name: tt('view.reconnect') })).toBeInTheDocument()
    await userEvent.click(again)
    await waitFor(() => expect(f.api.send).toHaveBeenCalledWith('thread', 'Fix the login', []))
  })

  test.each(['en', 'pt-BR'] as const)('(%s) in the conversation the card is the failure\'s one owner: no strip above the composer, no second Failed line', async locale => {
    await changeLanguage(locale)
    const events = [msg('u1', 'user', 'Fix the login'), { ...failed({ code: 'authentication', message: 'Sign in again.' }), errorCode: 'authentication' }]
    view(fixture(events, { status: 'failed', turns: [{ id: 'u1', sequence: 1, status: 'failed', configuration: {} }] }))
    const cards = [...document.querySelectorAll<HTMLElement>('.thread-failure-card, [data-ui="failure-card"]')]
    expect(cards, 'one failure card').toHaveLength(1)
    expect(document.querySelectorAll('.thread-connection-notice'), 'no strip above the composer').toHaveLength(0)
    const outside = [...document.querySelectorAll<HTMLElement>('[data-ui="chat-column"] *')].filter(node => !cards[0].contains(node) && node.children.length === 0 && node.textContent?.trim() === tt('turnTiming.failed'))
    expect(outside.map(node => node.outerHTML.slice(0, 80)), 'no loose Failed line').toEqual([])
  })

  test('adds the fixed words and the new pairs to both catalogs', () => {
    for (const [name, pair] of Object.entries({ RETRY, TECHNICAL, COMPACTED, UNDO_TURN })) expect(pairKey('thread', pair.en, pair['pt-BR']), name).not.toBe('')
  })
})
