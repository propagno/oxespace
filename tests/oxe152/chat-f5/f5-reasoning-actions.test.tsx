// Frozen acceptance test for 1.5.2 OxeChat F5 · conversa AG-10/11, criterion A6 (task T6). Written by the planner; the
// executor must not edit it. Source: AG-11-CRITERIOS-F5.md (MARCA 15/11) rows 1.1, 1.2, 1.3, 1.4, 2.1 and 2.2, the
// rules "Fechado ou aberto" (machine noise closed in one --row-1 line), "Espaços" (6 px between the steps of one group)
// and "Movimento"; AG-10 §2.2 (the turn's work in one quiet line "▸ N ações", opened into 24 px rows with mono file
// pills and +N −M, a click opening the file in Alterações) and AG-11 §5.3 ("Linha de turno usa 'ações'"). It takes the
// turn-line of OxeChat F4 T10 (oxc-2-conversation: "the state word first, then the steps"), rewritten to AG-10's
// "N ações" (the state is said once, by the turn's footer, ThreadTurnTiming).
// Today (main 12b8e900b): the reasoning is a <details> with a <pre> (mono box, italic), no hook; a finished turn folds
// into "N steps" (fold.steps) with a list icon; a run of reads is "Read 5 files, searched 2" with no duration; the rows
// have no past-tense verb and their target is plain text.
// Contract (data-ui proposed by MARCA, fixed here; "[css]" cases read the stylesheets, rigor source-assertion):
// - [data-ui=reasoning] per reasoning block, data-state "streaming" | "done". Its toggle is a button with aria-expanded.
//   Streaming (1.1): the label reasoning.thinking ("Pensando…"), a [data-ui=reasoning-pulse] (its class never contains
//   "spin", so base.css stills it under data-motion=reduce, which Settings sets from the system's reduced motion too),
//   and the preview: the latest 2–3 lines in --font-ui, never a <pre>, never mono ([css] line clamp 2 or 3).
//   Done (1.2): closed by itself, one line reasoning.thoughtFor ("Pensou por 6 s"), no box and no border ([css]), the
//   toggle at --row-1. Open (1.3): aria-expanded=true, the text in paragraphs in --tx-secondary with a 2 px rule on the left.
// - Interleaved (1.4): reasoning → tools → reasoning keep their real order on the same axis.
// - [data-ui=explore-group] (2.1): a run of reads and searches is one block whose toggle button is closed (aria-expanded=false), reading
//   "Explored 5 files and 2 searches · 1.8 s" / "Explorou 5 arquivos e 2 buscas · 1,8 s" (the span from the first start
//   to the last end); opened (2.2), one [data-ui=step] row per step inside the block: a past-tense verb and the target as a link (the
//   PathLink of the timeline): "Read src/pix/refund.ts · L1–90" / "Leu src/pix/refund.ts · L1–90" (offset/limit of the
//   input), 'Searched "idempotencyKey" · 4 results' / 'Buscou "idempotencyKey" · 4 achados' (the output's lines);
//   [css] each row 24 px, 6 px between steps.
// - [data-ui=turn-line] (AG-10 §2.2): a finished turn's work folds into one button "5 actions" / "5 ações" (1 action /
//   1 ação), N counting the turn's tool steps only (not its thoughts nor its messages), closed; opened, its rows follow; an edit shows a [data-ui=file-pill] in --font-mono with "+4 −1" on its
//   right, and a click on the pill opens the Changes panel of the conversation at that file
//   (useThreadWorkbenchStore view: panel 'changes').
// - Brand targets: BRD-25.fold.height, step.height and reasoning.font (T14's brd-25.json) turn enforced here; the F4-era
//   BRD-04.turn-line.font-size is replaced: it stays pending with a note "substituída pelo BRD-25" (liberação de medida:
//   coordenação 15/11, BRD-04 substituído por AG-10/AG-11 (decisão do usuário), pending no PR que entrega a substituição).
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAccountStore } from '../../../src/store/account.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { useThreadWorkbenchStore } from '../../../src/store/thread-workbench.store'
import { ThreadView } from '../../../src/components/Threads/ThreadView'
import { changeLanguage, i18n } from '../../../src/i18n'
import type { Workspace } from '../../../shared/types/workspace'
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
const reasoning = (id: string, text: string, startedAt: number, completedAt?: number) => ({ type: 'reasoning', id, text, startedAt, ...(completedAt ? { completedAt } : {}) })
const THOUGHT = 'The refund handler retries on timeout.\nA retry can post the same refund twice.\nAn idempotency key stops the second post.\nIt should come from the request header.'
const read = (id: string, file: string, at: number, extra: Record<string, unknown> = {}) => tool(id, 'Read', { detail: JSON.stringify({ file_path: file, ...extra }), startedAt: at, completedAt: at + 100 })
const grep = (id: string, pattern: string, at: number, hits: number) => tool(id, 'Grep', { detail: JSON.stringify({ pattern }), output: Array.from({ length: hits }, (_, i) => `src/pix/file${i}.ts:${i + 1}: ${pattern}`).join('\n'), startedAt: at, completedAt: at + 100 })
// 5 reads and 2 searches from 1 000 to 2 800 ms: the span is 1.8 s.
const EXPLORE = [read('r1', '/repo/src/pix/refund.ts', 1_000, { offset: 1, limit: 90 }), read('r2', '/repo/src/pix/client.ts', 1_200), read('r3', '/repo/src/pix/types.ts', 1_400), read('r4', '/repo/src/pix/retry.ts', 1_600),
  read('r5', '/repo/src/pix/index.ts', 1_800), grep('g1', 'idempotencyKey', 2_200, 4), grep('g2', 'refundId', 2_700, 2)]
const RUNNING = { status: 'running' as const, turns: [{ id: 'u1', sequence: 1, status: 'running', configuration: {} }] }
const FILE = { path: '/repo/src/pix/refund.ts', kind: 'update', source: 'native-patch', state: 'completed', additions: 4, deletions: 1 }
const FINISHED = [msg('u1', 'user', 'Make refunds idempotent'), read('f1', '/repo/src/pix/refund.ts', 1_000), tool('f2', 'Edit', { detail: JSON.stringify({ file_path: '/repo/src/pix/refund.ts' }), files: [FILE] }),
  tool('f3', 'Bash', { detail: 'npm test', exitCode: 0 }), read('f4', '/repo/src/pix/client.ts', 3_000), tool('f5', 'Bash', { detail: 'npm run lint', exitCode: 0 }), msg('a1', 'assistant', 'Refunds now carry an idempotency key.'), done()]
const view = (f: ReturnType<typeof fixture>) => render(<ThreadView workspace={f.workspace} />)
const blocks = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-ui="reasoning"]')]
const toggleOf = (block: HTMLElement): HTMLElement => {
  const buttons = within(block).getAllByRole('button').filter(button => button.hasAttribute('aria-expanded'))
  expect(buttons, 'the block opens with one button that says whether it is open').toHaveLength(1)
  return buttons[0]
}
const monoish = (value: string | undefined): boolean => /--font-mono|monospace|Plex Mono|Consolas/i.test(value ?? '')

beforeEach(() => { localStorage.clear() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); document.documentElement.removeAttribute('data-motion'); await changeLanguage('en') })

describe('A6 · reasoning (rows 1.1 to 1.4)', () => {
  test.each(['en', 'pt-BR'] as const)('(%s) thinking live: one "Thinking…" line with a pulse and a 2–3 line preview in the interface font, never a <pre>', async locale => {
    await changeLanguage(locale)
    view(fixture([msg('u1', 'user', 'Make refunds idempotent'), reasoning('th1', THOUGHT, 1_000)], RUNNING))
    const block = one('[data-ui="reasoning"]')
    expect(block).toHaveAttribute('data-state', 'streaming')
    expect(words(block)).toContain(tt('reasoning.thinking'))
    expect(block.querySelector('pre'), 'no raw <pre>').toBeNull()
    const pulse = one('[data-ui="reasoning-pulse"]', block)
    expect(pulse.getAttribute('class') ?? '', 'the pulse is not a busy spinner: data-motion=reduce stills it (base.css)').not.toMatch(/spin/i)
    const preview = [...block.querySelectorAll<HTMLElement>('p, div')].find(node => words(node).includes('An idempotency key stops the second post.'))
    expect(preview, 'the preview shows the latest thought').toBeTruthy()
    for (let node: HTMLElement | null = preview!; node && node !== block.parentElement; node = node.parentElement) expect(monoish(css(node, 'font-family')), 'never mono').toBe(false)
  })

  test('[css] the live preview is 2 or 3 lines, in the interface font', () => {
    view(fixture([msg('u1', 'user', 'Make refunds idempotent'), reasoning('th1', THOUGHT, 1_000)], RUNNING))
    const block = one('[data-ui="reasoning"]')
    const clamps = [...block.querySelectorAll<HTMLElement>('*'), block].map(node => css(node, ['-webkit-line-clamp', 'line-clamp'])).filter(Boolean)
    expect(clamps.length, 'a line clamp on the preview').toBeGreaterThan(0)
    expect(['2', '3']).toContain(clamps[0])
  })

  test.each(['en', 'pt-BR'] as const)('(%s) thinking done: closed by itself in one "Thought for 6 s" line; opened, the text in paragraphs', async locale => {
    await changeLanguage(locale)
    view(fixture([msg('u1', 'user', 'Make refunds idempotent'), reasoning('th1', THOUGHT, 1_000, 7_000), tool('t1', 'Bash', { detail: 'npm test', state: 'running' })], RUNNING))
    const block = one('[data-ui="reasoning"]')
    expect(block).toHaveAttribute('data-state', 'done')
    const toggle = toggleOf(block)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(words(toggle)).toBe(tt('reasoning.thoughtFor', { duration: tt('reasoning.seconds', { seconds: 6 }) }))
    expect(within(block).queryByText('A retry can post the same refund twice.'), 'closed: the text waits').toBeNull()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const paragraph = within(block).getByText('A retry can post the same refund twice.')
    expect(paragraph.closest('pre'), 'paragraphs, not a <pre>').toBeNull()
    expect(paragraph.tagName).toBe('P')
  })

  test('[css] done: no box and no border, its line at --row-1; opened: --tx-secondary text with a 2 px rule on the left', async () => {
    view(fixture([msg('u1', 'user', 'Make refunds idempotent'), reasoning('th1', THOUGHT, 1_000, 7_000), tool('t1', 'Bash', { detail: 'npm test', state: 'running' })], RUNNING))
    const block = one('[data-ui="reasoning"]')
    for (const prop of ['border', 'border-width', 'border-style']) expect(css(block, prop) ?? 'none', `no ${prop}`).toMatch(/^(none|0|0px)$/)
    expect(css(block, ['background', 'background-color']) ?? 'none', 'no box').toMatch(/^(none|transparent)$/)
    const toggle = toggleOf(block)
    expect(usesTok(css(toggle, ['height', 'min-height']), 'row-1'), 'the line is --row-1').toBe(true)
    await userEvent.click(toggle)
    const body = within(block).getByText('A retry can post the same refund twice.').parentElement!
    const rule = [body, ...[...body.querySelectorAll('*')]].map(node => css(node, ['border-left', 'border-inline-start'])).find(Boolean)
    expect(px((rule ?? '').split(/\s+/)[0]), 'a 2 px rule on the left').toBe(2)
    const colour = [body, body.parentElement!].map(node => css(node, 'color')).find(Boolean)
    expect(usesTok(colour, 'tx-secondary'), 'the text in --tx-secondary').toBe(true)
  })

  test('interleaved: thought, tools and thought again keep their real order on the same axis', () => {
    view(fixture([msg('u1', 'user', 'Make refunds idempotent'), reasoning('th1', 'Look at the handler first.', 1_000, 3_000), read('r1', '/repo/src/pix/refund.ts', 3_100),
      reasoning('th2', 'The retry is in the client.', 3_400, 5_400), tool('t2', 'Bash', { detail: 'npm test', state: 'running' })], RUNNING))
    const column = one('[data-ui="chat-column"]')
    const order = [...column.querySelectorAll<HTMLElement>('[data-ui="reasoning"], [data-ui="explore-group"], [data-ui="step"]')].map(node => node.getAttribute('data-ui') === 'reasoning' ? 'thought' : 'tools')
    expect(order.filter((value, index) => value !== order[index - 1]), 'thought, tools, thought').toEqual(expect.arrayContaining(['thought', 'tools', 'thought']))
    expect(order[0]).toBe('thought')
    expect(order.lastIndexOf('thought')).toBeGreaterThan(order.indexOf('tools'))
  })
})

describe('A6 · exploration (rows 2.1 and 2.2)', () => {
  const EXPLORED = { en: 'Explored 5 files and 2 searches · 1.8 s', 'pt-BR': 'Explorou 5 arquivos e 2 buscas · 1,8 s' } as const
  test.each(['en', 'pt-BR'] as const)('(%s) five reads and two searches are one closed line with the span', async locale => {
    await changeLanguage(locale)
    view(fixture([msg('u1', 'user', 'Make refunds idempotent'), ...EXPLORE, tool('t9', 'Bash', { detail: 'npm test', state: 'running' })], RUNNING))
    const group = one('[data-ui="explore-group"]')
    const button = toggleOf(group)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(words(button)).toBe(EXPLORED[locale])
    expect(group.querySelectorAll('[data-ui="step"]'), 'closed: no step rows').toHaveLength(0)
  })

  test.each(['en', 'pt-BR'] as const)('(%s) opened: one row per step, a past-tense verb and the target as a link, with the lines read and the hits found', async locale => {
    await changeLanguage(locale)
    view(fixture([msg('u1', 'user', 'Make refunds idempotent'), ...EXPLORE, tool('t9', 'Bash', { detail: 'npm test', state: 'running' })], RUNNING))
    const group = one('[data-ui="explore-group"]')
    await userEvent.click(toggleOf(group))
    const rows = [...group.querySelectorAll<HTMLElement>('[data-ui="step"]')]
    expect(rows).toHaveLength(7)
    const first = locale === 'en' ? 'Read src/pix/refund.ts · L1–90' : 'Leu src/pix/refund.ts · L1–90'
    const search = locale === 'en' ? 'Searched "idempotencyKey" · 4 results' : 'Buscou "idempotencyKey" · 4 achados'
    expect(words(rows[0])).toBe(first)
    expect(within(rows[0]).getByRole('link', { name: /src\/pix\/refund\.ts/ }), 'the target is a link that opens the file').toBeInTheDocument()
    expect(words(rows[5])).toBe(search)
  })

  test('[css] opened, each step is a 24 px row and the steps of one group are 6 px apart', async () => {
    view(fixture([msg('u1', 'user', 'Make refunds idempotent'), ...EXPLORE, tool('t9', 'Bash', { detail: 'npm test', state: 'running' })], RUNNING))
    const group = one('[data-ui="explore-group"]')
    await userEvent.click(toggleOf(group))
    const row = group.querySelectorAll<HTMLElement>('[data-ui="step"]')[1]
    expect(px(css(row, ['height', 'min-height'])), 'a 24 px row').toBe(24)
    const gap = [row.parentElement!].map(node => css(node, ['gap', 'row-gap'])).find(Boolean) ?? css(row, ['margin-top', 'margin-block-start'])
    expect(px(gap), '6 px between steps').toBe(6)
  })
})

describe('A6 · the turn line "N ações" with file pills (AG-10 §2.2)', () => {
  const ACTIONS = { en: '5 actions', 'pt-BR': '5 ações' } as const
  test.each(['en', 'pt-BR'] as const)('(%s) a finished turn folds its work into one closed line that counts the actions', async locale => {
    await changeLanguage(locale)
    view(fixture(FINISHED, { turns: [{ id: 'u1', sequence: 1, status: 'completed', startedAt: 1, completedAt: 41_001, configuration: {} }] }))
    const line = one('[data-ui="turn-line"]', one('[data-ui="chat-column"]'))
    const button = line.matches('button') ? line : toggleOf(line)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(words(button).startsWith(ACTIONS[locale]), `"${words(button)}" starts with ${ACTIONS[locale]}`).toBe(true)
    expect(screen.getByText('Refunds now carry an idempotency key.'), 'the answer stays in view').toBeInTheDocument()
    expect(document.querySelector('[data-ui="file-pill"]'), 'closed: no rows').toBeNull()
  })

  test('one action reads "1 action" / "1 ação"', async () => {
    const turn = [msg('u1', 'user', 'Check'), read('o1', '/repo/a.ts', 1_000), tool('o2', 'Bash', { detail: 'npm test', exitCode: 0 }), msg('a1', 'assistant', 'Fine.'), done()]
    view(fixture(turn, { turns: [{ id: 'u1', sequence: 1, status: 'completed', configuration: {} }] }))
    expect(words(one('[data-ui="turn-line"]')).startsWith('2 actions')).toBe(true)
    cleanup()
    await changeLanguage('pt-BR')
    const single = [msg('u1', 'user', 'Check'), read('o1', '/repo/a.ts', 1_000), msg('a0', 'assistant', 'Reading.'), msg('a1', 'assistant', 'Fine.'), done()]
    view(fixture(single, { turns: [{ id: 'u1', sequence: 1, status: 'completed', configuration: {} }] }))
    expect(words(one('[data-ui="turn-line"]')).startsWith('1 ação')).toBe(true)
  })

  test('opened, an edit shows a mono file pill with +4 −1, and a click opens the file in the conversation\'s Changes panel', async () => {
    view(fixture(FINISHED, { turns: [{ id: 'u1', sequence: 1, status: 'completed', configuration: {} }] }))
    const line = one('[data-ui="turn-line"]')
    await userEvent.click(line.matches('button') ? line : toggleOf(line))
    const pill = await waitFor(() => one('[data-ui="file-pill"]'))
    expect(words(pill)).toContain('src/pix/refund.ts')
    const row = pill.closest('[data-ui="step"]') ?? pill.parentElement!
    expect(words(row)).toMatch(/\+4\s*[−-]1/)
    expect(monoish(css(pill, 'font-family')), '[css] the pill is mono').toBe(true)
    await userEvent.click(pill)
    expect(useThreadWorkbenchStore.getState().views.thread?.panel, 'Changes opens').toBe('changes')
  })

  test('[css] the turn line is one --row-1 line', () => {
    view(fixture(FINISHED, { turns: [{ id: 'u1', sequence: 1, status: 'completed', configuration: {} }] }))
    const line = one('[data-ui="turn-line"]')
    const button = line.matches('button') ? line : toggleOf(line)
    expect([line, button].some(node => usesTok(css(node, ['height', 'min-height']), 'row-1')), 'height --row-1').toBe(true)
  })

  test('adds the words of the new lines to both catalogs (explored, read, searched, actions)', () => {
    const en = flatCatalog('thread', 'en'), pt = flatCatalog('thread', 'pt-BR')
    for (const [label, english, portuguese] of [['actions', /\{\{count\}\} actions?/, /\{\{count\}\} aç(ão|ões)/], ['searches', /search(es)?/, /buscas?/], ['results', /results?/, /achados?/]] as const) {
      const keys = Object.keys(en).filter(key => english.test(en[key]) && portuguese.test(pt[key] ?? ''))
      expect(keys.length, `${label}: a key in both catalogs`).toBeGreaterThan(0)
    }
  })

  test('turns its BRD-25 measures to enforced (SOURCE-TEXT check of the target data, marked)', () => {
    expect(notEnforced(['BRD-25.fold.height', 'BRD-25.step.height', 'BRD-25.reasoning.font'])).toEqual([])
  })

  test('the old turn line measure stays pending, noted as replaced by BRD-25 (release of the coordinator 15/11; SOURCE-TEXT, marked)', () => {
    const measure = measureOf('BRD-04.turn-line.font-size')
    expect(measure?.state).toBe('pending')
    expect(measure?.note ?? '').toMatch(/BRD-25/)
  })
})
