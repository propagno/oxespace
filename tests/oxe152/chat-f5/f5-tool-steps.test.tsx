// Frozen acceptance test for 1.5.2 OxeChat F5 · conversa AG-10/11, criterion A7 (task T7). Written by the planner; the
// executor must not edit it. Source: AG-11-CRITERIOS-F5.md (MARCA 15/11) rows 2.3, 2.4a, 2.4b, 2.4c, 2.5 and 2.6, and
// the rules "Fechado ou aberto" (a command with exit 0 closed in one --row-1 line; a failed command open by itself) and
// "Estados" (always StatusSignal, no emoji); AG-10 §2.2 ("$ pnpm test" with a quiet ✓) and board 2B (the six kinds).
// It builds on T6's [data-ui=step] rows (depends on T6).
// Today (main 12b8e900b): a command is a ToolRowView row ("Run npm test") with a spinner but no exit signal; a failed one
// shows a diagnostic with "Technical details" closed and no --term-bg output; no kind badge; the background strip says
// "Running" with no port; the subagent card has no StatusSignal per agent nor a connector.
// Contract ("[css]" cases read the stylesheets, rigor source-assertion):
// - Every tool step is a [data-ui=step] with data-kind (read | edit | run | query | http | container | other, from
//   shared/thread-tool-rows classifyToolRowKind) and data-state (running | done | failed). A finished step leads with a
//   StatusSignal (src/ui) done or failed; a running one with the src/ui Spinner.
// - run (2.4): the command in <code> in --font-mono after "$ ". Running (2.4a): the Spinner. exit 0 (2.4b): closed, one
//   line ([css] --row-1), StatusSignal done. exit ≠ 0 (2.4c): open by itself; its output in [data-ui=step-output] on
//   --term-bg ([css], both themes: the token is one); the last 12 lines shown, and when there are more a button "Show N
//   more lines" / "Mostrar mais N linhas" that shows them; StatusSignal failed.
// - query / http / other (2.5): a [data-ui=kind-badge] per step, [css] coloured by --k-db (query), --k-net (http) and
//   --k-box (other, MCP); the result closed by default; a query step opened shows its rows as a small table; an http step
//   shows the status ("200 OK") on its line; an MCP step names "server · tool" (mcp__github__create_issue → "github ·
//   create_issue") with its JSON closed.
// - edit (2.3): the step reads "[file] +N −M"; opened it shows the diff (ThreadPatch from the change's artifact:
//   window.oxe.thread.artifact) with old/new line numbers and, per line, the "+" button named thread patch.commentOnNew
//   that puts a comment for the agent in the composer.
// - subagents (2.6): ThreadSubagentActivity shows each agent with its own StatusSignal (running → working, completed →
//   done, failed → failed) and a curved [data-ui=subagent-connector] (an svg path) from the parent; the background strip
//   (ThreadBackgroundShells) reads "Running · port 5173" / "Rodando · porta 5173" when the shell's output names a local
//   address with a port (localhost or 127.0.0.1), else "Running".
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAccountStore } from '../../../src/store/account.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { ThreadView } from '../../../src/components/Threads/ThreadView'
import { ThreadSubagentActivity } from '../../../src/components/Threads/ThreadSubagentActivity'
import { ThreadBackgroundShells } from '../../../src/components/Threads/ThreadBackgroundShells'
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
const RUNNING = { status: 'running' as const, turns: [{ id: 'u1', sequence: 1, status: 'running', configuration: {} }] }
const view = (f: ReturnType<typeof fixture>) => render(<ThreadView workspace={f.workspace} />)
const steps = (kind?: string): HTMLElement[] => {
  const found = [...document.querySelectorAll<HTMLElement>(`[data-ui="step"]${kind ? `[data-kind="${kind}"]` : ''}`)]
  expect(found.length, `a [data-ui=step]${kind ? `[data-kind=${kind}]` : ''} in the conversation`).toBeGreaterThan(0)
  return found
}
const signal = (root: Element): string | null => root.querySelector('[data-ui="status-signal"]')?.getAttribute('data-state') ?? null
const STDERR = Array.from({ length: 20 }, (_, i) => `FAIL src/pix/refund.test.ts › case ${i + 1}`).join('\n')
const say = (id: string) => msg(id, 'assistant', 'Next.')
const monoish = (value: string | undefined): boolean => /--font-mono|monospace/i.test(value ?? '')

beforeEach(() => { localStorage.clear() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('A7 · commands (rows 2.4a, 2.4b, 2.4c)', () => {
  test('running: the spinner and the command in mono after "$ "', () => {
    view(fixture([msg('u1', 'user', 'Run the tests'), tool('c1', 'Bash', { detail: JSON.stringify({ command: 'pnpm test' }), state: 'running', completedAt: undefined })], RUNNING))
    const [step] = steps('run')
    expect(step).toHaveAttribute('data-state', 'running')
    const spinnerClass = Object.values(import.meta.glob('../../../src/ui/Display.module.css', { eager: true }) as Record<string, { default: Record<string, string> }>)[0].default.spinner
    expect(step.querySelector(`.${spinnerClass}`), 'the src/ui Spinner').toBeTruthy()
    const code = within(step).getByText('pnpm test', { selector: 'code, code *' })
    expect(words(step)).toContain('$ pnpm test')
    expect(monoish(css(code.closest('code')!, 'font-family')), '[css] mono').toBe(true)
  })

  test('exit 0: closed in one line with the done signal', () => {
    view(fixture([msg('u1', 'user', 'Run the tests'), tool('c1', 'Bash', { detail: JSON.stringify({ command: 'pnpm test' }), exitCode: 0, output: 'ok 12 tests' }), say('a1'), tool('c9', 'Bash', { detail: 'sleep 9', state: 'running' })], RUNNING))
    const step = steps('run').find(node => words(node).includes('pnpm test'))!
    expect(step).toHaveAttribute('data-state', 'done')
    expect(signal(step), 'StatusSignal done').toBe('done')
    expect(within(step).queryByText('ok 12 tests'), 'closed: the output waits').toBeNull()
    expect(usesTok(css(step, ['height', 'min-height']), 'row-1') || [...step.children].some(child => usesTok(css(child, ['height', 'min-height']), 'row-1')), '[css] one --row-1 line').toBe(true)
  })

  test.each(['en', 'pt-BR'] as const)('(%s) exit ≠ 0: open by itself, the last lines on --term-bg, "Show N more lines", the failed signal', async locale => {
    await changeLanguage(locale)
    view(fixture([msg('u1', 'user', 'Run the tests'), tool('c1', 'Bash', { detail: JSON.stringify({ command: 'pnpm test' }), state: 'failed', exitCode: 1, output: STDERR }), say('a1'), tool('c9', 'Bash', { detail: 'sleep 9', state: 'running' })], RUNNING))
    const step = steps('run').find(node => words(node).includes('pnpm test'))!
    expect(step).toHaveAttribute('data-state', 'failed')
    expect(signal(step)).toBe('failed')
    const output = one('[data-ui="step-output"]', step)
    expect(words(output), 'open by itself, the last line in view').toContain('case 20')
    expect(words(output), 'only the last 12 lines').not.toContain('case 8 ')
    expect(usesTok(css(output, ['background', 'background-color']), 'term-bg'), '[css] on --term-bg').toBe(true)
    const more = within(step).getByRole('button', { name: locale === 'en' ? 'Show 8 more lines' : 'Mostrar mais 8 linhas' })
    await userEvent.click(more)
    expect(words(one('[data-ui="step-output"]', step))).toContain('case 1 ')
  })
})

describe('A7 · SQL, HTTP and MCP (row 2.5)', () => {
  const MIXED = [msg('u1', 'user', 'Check the data'),
    tool('q1', 'mcp__oxespace__oxespace_db_query', { detail: JSON.stringify({ sql: 'select id, amount from refunds' }), output: JSON.stringify({ columns: ['id', 'amount'], rows: [[1, '10.00'], [2, '25.50']] }) }), say('a1'),
    tool('h1', 'WebFetch', { detail: JSON.stringify({ url: 'http://localhost:3000/refunds' }), output: 'HTTP/1.1 200 OK\n\n[]' }), say('a2'),
    tool('m1', 'mcp__github__create_issue', { detail: JSON.stringify({ title: 'Refund twice' }), output: JSON.stringify({ number: 42 }) }), say('a3'),
    tool('c9', 'Bash', { detail: 'sleep 9', state: 'running' })]
  test('[css] one badge per kind in its token: --k-db for SQL, --k-net for HTTP, --k-box for MCP', () => {
    view(fixture(MIXED, RUNNING))
    for (const [kind, token] of [['query', 'k-db'], ['http', 'k-net'], ['other', 'k-box']] as const) {
      const step = steps(kind)[0]
      expect(step, `a ${kind} step`).toBeTruthy()
      const badge = one('[data-ui="kind-badge"]', step)
      const paint = [css(badge, 'color'), css(badge, ['background', 'background-color']), css(badge, ['border', 'border-color'])].join(' ')
      expect(usesTok(paint.match(/var\([^)]*\)/g)?.find(value => value.includes(token)) ?? '', token), `${kind}: var(--${token})`).toBe(true)
    }
  })

  test('the results wait closed; SQL opens into a small table, HTTP says its status, MCP names server · tool with its JSON closed', async () => {
    view(fixture(MIXED, RUNNING))
    const query = steps('query')[0], http = steps('http')[0], mcp = steps('other')[0]
    expect(within(query).queryByRole('table'), 'closed').toBeNull()
    expect(words(http)).toContain('200 OK')
    expect(words(mcp)).toContain('github · create_issue')
    expect(words(mcp), 'the JSON waits').not.toContain('"number"')
    await userEvent.click(within(query).getAllByRole('button').find(button => button.hasAttribute('aria-expanded'))!)
    const table = within(query).getByRole('table')
    expect(within(table).getAllByRole('row').length, 'header and two rows').toBe(3)
    expect(words(table)).toContain('25.50')
  })
})

describe('A7 · edit with a mini diff (row 2.3)', () => {
  const PATCH = 'diff --git a/src/pix/refund.ts b/src/pix/refund.ts\n--- a/src/pix/refund.ts\n+++ b/src/pix/refund.ts\n@@ -10,3 +10,4 @@ export function refund() {\n   const key = header()\n-  post(body)\n+  if (seen(key)) return\n+  post(body, key)\n }\n'
  const FILE = { path: '/repo/src/pix/refund.ts', kind: 'update', source: 'native-patch', state: 'completed', additions: 18, deletions: 4, artifactId: 'art-1' }
  test('the step reads "[file] +18 −4"; opened, the coloured diff with line numbers and a "+" to comment a line, which goes to the composer', async () => {
    const artifact = vi.fn(async () => ({ id: 'art-1', source: 'native-patch', content: PATCH, truncated: false }))
    view(fixture([msg('u1', 'user', 'Make it idempotent'), tool('e1', 'Edit', { detail: JSON.stringify({ file_path: '/repo/src/pix/refund.ts' }), files: [FILE] }), say('a1'), tool('c9', 'Bash', { detail: 'sleep 9', state: 'running' })], { ...RUNNING, api: { artifact } }))
    const step = steps('edit')[0]
    expect(words(step)).toMatch(/src\/pix\/refund\.ts\s*\+18\s*[−-]4/)
    await userEvent.click(within(step).getAllByRole('button').find(button => button.hasAttribute('aria-expanded'))!)
    await waitFor(() => expect(artifact).toHaveBeenCalledWith('thread', 'art-1'))
    const comment = await within(step).findByRole('button', { name: tt('patch.commentOnNew', { line: 12 }) })
    expect(words(step)).toContain('if (seen(key)) return')
    await userEvent.click(comment)
    await userEvent.type(within(step).getByRole('textbox', { name: tt('patch.commentLabel') }), 'Log the skipped refund')
    await userEvent.click(within(step).getByRole('button', { name: tt('patch.add') }))
    await waitFor(() => expect(useThreadStore.getState().drafts.thread ?? '').toContain('Log the skipped refund'))
  })
})

describe('A7 · its brand measures', () => {
  test('turns BRD-25.run-failed.open, run-ok.closed and stderr.bg to enforced (SOURCE-TEXT check of the target data, marked)', () => {
    expect(notEnforced(['BRD-25.run-failed.open', 'BRD-25.run-ok.closed', 'BRD-25.stderr.bg'])).toEqual([])
  })
})

describe('A7 · subagents and background work (row 2.6)', () => {
  test('each subagent shows its own state signal, joined by a curved connector', () => {
    const event = { type: 'subagent', id: 's1', action: 'spawn', state: 'running', receiverThreadIds: ['a', 'b'], agents: [
      { threadId: 'a', status: 'running', message: 'Read the client' }, { threadId: 'b', status: 'completed', message: 'Write the test' }, { threadId: 'c', status: 'failed', message: 'Run lint' }] }
    const Subagents = ThreadSubagentActivity as unknown as (props: Record<string, unknown>) => JSX.Element
    render(<Subagents event={event} compact />)
    const states = [...document.querySelectorAll('[data-ui="status-signal"]')].map(node => node.getAttribute('data-state'))
    expect(states, 'one signal per agent').toEqual(['working', 'done', 'failed'])
    expect(document.querySelectorAll('[data-ui="subagent-connector"]').length, 'the curved connector').toBeGreaterThan(0)
    expect(document.querySelector('[data-ui="subagent-connector"] path, path[data-ui="subagent-connector"]'), 'an svg path').toBeTruthy()
  })

  test.each(['en', 'pt-BR'] as const)('(%s) a background dev server reads "Running · port 5173"', async locale => {
    await changeLanguage(locale)
    const shells = [{ id: 'b1', command: 'pnpm dev', startedBy: 'agent', state: 'running', since: 1, tail: ['VITE v5 ready', '  ➜  Local:   http://localhost:5173/'], canStop: false }]
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { background: vi.fn(async () => shells), onBackgroundChanged: vi.fn(() => () => {}) } } })
    render(<ThreadBackgroundShells threadId="thread" />)
    expect(await screen.findByText(locale === 'en' ? 'Running · port 5173' : 'Rodando · porta 5173', { exact: false })).toBeInTheDocument()
  })

  test('a background command that names no port reads only "Running"', async () => {
    const shells = [{ id: 'b1', command: 'pnpm build --watch', startedBy: 'agent', state: 'running', since: 1, tail: ['built in 3 s'], canStop: false }]
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { background: vi.fn(async () => shells), onBackgroundChanged: vi.fn(() => () => {}) } } })
    render(<ThreadBackgroundShells threadId="thread" />)
    expect(await screen.findByText(tt('backgroundShells.running'), { exact: false })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/port|porta/)
  })
})
