// Frozen acceptance test for 1.5.2 OxeChat F5 · conversa AG-10/11, criterion A5 (task T5). Written by the planner; the
// executor must not edit it. Source: AG-11-CRITERIOS-F5.md (MARCA 15/11): "Regras que valem para todas as linhas" (one
// left axis at 800 px, BRD-04.column.width; no bubble on the right), row 1.0 (empty conversation), the rows "Cartão de
// prompt" (Copiar, Editar) and "Cabeçalho" (only the title and the worktree chip; no "agente · projeto · acesso"
// line); AG-10 §2.1, §2.6 and boards 1A–1C; POLISH-09 #3 (3) and #4 (a) (no strip under the H1). It SUPERSEDES OxeChat F4
// T10 (tests/oxe152/chat/oxc-2-conversation.test.tsx on oxe-152-chat-f4, never on main): what still matches AG-10/11 is
// kept here (chat-header/chat-title/chat-column/user-message, the ⋯ menu in four groups of BRD-21 and "Abrir no OxeCode"
// of the brand 15/11); its subline (agent, project, branch) is rewritten (AG-10 §2.6 removes it); its turn-line, request
// card and failure card are now T6, T10 and T11.
// Today (main 12b8e900b): the user message is a bubble pushed right (.thread-message-user: margin-left auto, max-width
// 82 %), with no actions; the header shows the ThreadSubline (agent, project, branch, access) and the NowLine strip; no
// data-ui hooks; the empty conversation shows the provider icon, not the Ramo mark.
// Contract (pixels are the conformance scenes' job, marca/conformidade: this task turns ITS measures of brd-04/brd-05 to
// enforced; this file pins structure, words and behaviour; "[css]" cases read the stylesheets, rigor source-assertion):
// - Header: one [data-ui=chat-header]; its [data-ui=chat-title] is the level-1 heading with the title. Nothing else of the
//   old subline: no agent name, no project name, no access word, no branch, unless the conversation has its OWN worktree
//   (thread.ownedWorktree): then one [data-ui=chat-worktree] chip with its branch. No NowLine strip in the header (no
//   role=status line, no Deny/Allow there): the request card in the conversation is the one owner (POLISH-09 rule 4).
//   The collision chip stays in the header (frozen 1.5.0 CR-F4-8 pins it there).
// - Brand targets (CENAS-E-ALVOS-20261115 part B, via the coordinator 15/11): this task turns BRD-25.column.width,
//   prompt.align, prompt.radius, turn-gap and header.meta (T14's brd-25.json) to enforced. The prompt card's hook is
//   prompt-card: the BRD-04 user-message bubble is replaced, so BRD-04.user-message.* stay pending with a note
//   "substituída pelo BRD-25" (liberação de medida: coordenação 15/11, BRD-04 substituído por AG-10/AG-11 (decisão do
//   usuário), pending no PR que entrega a substituição). Each turn's section carries data-ui=turn and data-turn-id.
// - Column: one [data-ui=chat-column] holds the transcript (the header outside it); every prompt is a
//   [data-ui=prompt-card] with the person's text, never an answer, on the same left axis as the answer: no rule pushes
//   it right (no margin-left auto, no align-self/justify-self end, no max-width under the column), --surface-raised,
//   --bd-subtle border, --radius-lg, padding 12/16.
// - Prompt card actions, shown under the pointer or with focus inside ([css]: hidden at rest): "Copy prompt"/"Copiar prompt"
//   on every prompt, copying exactly its text (window.oxe.clipboard.writeText, as the answers' copy does); "Edit
//   prompt"/"Editar prompt" only on the prompt shared/threadPromptEdit.ts:editablePrompt names (T2) and only when the
//   window has thread.editPrompt. Edit opens an editor in the card: a textbox with the text, Cancel (thread common.cancel)
//   and Send (thread composer.send); when that turn changed files, a checkbox "Undo this turn's changes" / "Desfazer as
//   alterações deste turno", unchecked by default. Send calls thread.editPrompt(threadId, turnId, text, { restoreFiles }).
// - Edited (MARCA 15/11, answer 1): a prompt whose turn has editedInto (T2) stays, marked "Edited · resent below" /
//   "Editado · reenviado abaixo", with no Edit; the new prompt card follows; nothing implies the old turn or its changes
//   are gone (the old turn's "Desfazer turno" stays where it is).
// - The column's width is the GENERATED token --measure-chat (800 px, T14; answer 4): [css] the column uses
//   var(--measure-chat), and BRD-04.column.width measures that token, not a literal.
// - Empty conversation (row 1.0): the Ramo symbol (an svg path whose d is src/design/brand.ts MARK_PATH), its title, the
//   composer, and exactly the 4 approved starters; nothing else of the example kind.
// - ⋯ menu (BRD-21 in F4, kept): today's items in four groups, destructive last; "Abrir no OxeCode" first in group 3, "Abrir a
//   worktree no OxeCode" with an owned worktree, calling ThreadHeader's onOpenInCode with the worktree or the root.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAccountStore } from '../../../src/store/account.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { ThreadView } from '../../../src/components/Threads/ThreadView'
import { ThreadHeader } from '../../../src/components/Threads/ThreadHeader'
import { threadStarters } from '../../../src/components/Threads/ThreadEmptyState'
import { MARK_PATH } from '../../../src/design/brand'
import { changeLanguage, i18n } from '../../../src/i18n'
import { threadAgentName } from '../../../shared/threadProviders'
import type { Workspace } from '../../../shared/types/workspace'
import type { ConversationThread } from '../../../shared/types/thread'
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
const PAIRS = {
  copy: { en: 'Copy prompt', 'pt-BR': 'Copiar prompt' },
  edit: { en: 'Edit prompt', 'pt-BR': 'Editar prompt' },
  undo: { en: 'Undo this turn\'s changes', 'pt-BR': 'Desfazer as alterações deste turno' },
  edited: { en: 'Edited · resent below', 'pt-BR': 'Editado · reenviado abaixo' }
} as const
const MEASURES = ['BRD-04.chat-header.height', 'BRD-04.column.width', 'BRD-05.title.font-size', 'BRD-05.title.font-weight', 'BRD-05.title.font-family',
  'BRD-25.column.width', 'BRD-25.prompt.align', 'BRD-25.prompt.radius', 'BRD-25.turn-gap', 'BRD-25.header.meta'] as const
/** Replaced by AG-10/11 (the bubble): released by the coordinator 15/11, they stay pending, noted as replaced by BRD-25. */
const REPLACED = ['BRD-04.user-message.radius', 'BRD-04.user-message.font-size'] as const

const FILE = { path: '/repo/src/auth.ts', kind: 'update', source: 'native-patch', state: 'completed', additions: 4, deletions: 1 }
const TURN = [msg('u1', 'user', 'Fix the login redirect'), tool('t1', 'Read', { detail: 'src/auth.ts' }), tool('t2', 'Edit', { detail: 'src/auth.ts', files: [FILE] }),
  msg('a1', 'assistant', 'The redirect now keeps the original path.'), done()]
const TWO_TURNS = [msg('u0', 'user', 'Explain the login flow'), msg('a0', 'assistant', 'It posts to /login.'), done(), ...TURN]
const TURNS = [{ id: 'u0', sequence: 1, status: 'completed', configuration: {} }, { id: 'u1', sequence: 2, status: 'completed', configuration: {} }]
const view = (f: ReturnType<typeof fixture>) => render(<ThreadView workspace={f.workspace} />)
const userCards = (): HTMLElement[] => [...one('[data-ui="chat-column"]').querySelectorAll<HTMLElement>('[data-ui="prompt-card"]')]

beforeEach(() => { localStorage.clear() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('A5 · the quiet header (AG-10 §2.6)', () => {
  test.each(['en', 'pt-BR'] as const)('(%s) one chat-header: the title as the h1 and nothing of the old subline: no agent, project, access or branch', async locale => {
    await changeLanguage(locale)
    view(fixture(TURN))
    const header = one('[data-ui="chat-header"]')
    const title = one('[data-ui="chat-title"]', header)
    expect(title).toHaveTextContent('Auth investigation')
    expect(within(header).getByRole('heading', { level: 1 })).toBe(title)
    const text = words(header)
    for (const echo of [threadAgentName('claude'), 'Repo', 'feat/thread', tt('config.chip.canEdit'), tt('config.readOnly'), tt('config.fullAccess')]) {
      expect(text, `the header does not repeat "${echo}" (it is in the sidebar and the composer)`).not.toContain(echo)
    }
    expect(header.querySelector('[data-ui="chat-worktree"]'), 'no worktree chip without an own worktree').toBeNull()
  })

  test('a conversation in its own worktree shows one worktree chip with its branch', () => {
    view(fixture(TURN, { thread: { rootPath: '/repo-worktrees/pix-refund', ownedWorktree: { path: '/repo-worktrees/pix-refund', branch: 'oxe-pix-refund', projectRoot: '/repo', baseSha: '0'.repeat(40), createdAt: 1 } } }))
    const chip = one('[data-ui="chat-worktree"]', one('[data-ui="chat-header"]'))
    expect(words(chip)).toContain('oxe-pix-refund')
  })

  test('no strip under the title: with a request waiting, the header has no status line and no Deny or Allow (POLISH-09 #4 a)', () => {
    const request = { id: 'req', nativeId: 'n', nativeMethod: 'can_use_tool:Bash', kind: 'approval', title: 'Run the tests', command: 'npm test', toolName: 'Bash', state: 'pending', generation: 1, createdAt: 1, availableDecisions: ['accept', 'decline'] }
    view(fixture([msg('u1', 'user', 'Run the tests'), { type: 'request', id: 'req', request }], { status: 'approval' }))
    const header = one('[data-ui="chat-header"]')
    expect(within(header).queryAllByRole('status'), 'no NowLine in the header').toEqual([])
    for (const key of ['request.deny', 'f7.card.allowOnce', 'f7.card.allow', 'nowLine.answer']) {
      const label = i18n.exists(`thread:${key}`) ? tt(key) : key
      expect(within(header).queryByRole('button', { name: new RegExp(`^${label}`, 'i') }), `no "${label}" in the header`).toBeNull()
    }
  })

  test('no strip under the title after a failure either: the failure card in the conversation is the one owner (POLISH-09 #3)', () => {
    view(fixture([msg('u1', 'user', 'Fix it'), done('failed', { failure: { id: 'f1', occurredAt: 1, code: 'server', message: 'The provider stopped the turn.' } })], { status: 'failed' }))
    const header = one('[data-ui="chat-header"]')
    expect(within(header).queryAllByRole('status')).toEqual([])
    expect(within(header).queryByRole('button', { name: new RegExp(tt('failure.retry'), 'i') })).toBeNull()
  })
})

describe('A5 · one left axis and the prompt card (AG-10 §2.1)', () => {
  test('one chat-column holds the transcript; each prompt is a user-message with the person\'s text, never an answer; the header is outside', () => {
    view(fixture(TWO_TURNS, { turns: TURNS }))
    const column = one('[data-ui="chat-column"]')
    expect(userCards().map(words)).toEqual([expect.stringContaining('Explain the login flow'), expect.stringContaining('Fix the login redirect')])
    for (const card of userCards()) expect(words(card)).not.toContain('The redirect now keeps the original path.')
    expect(within(column).getByText('The redirect now keeps the original path.')).toBeInTheDocument()
    expect(column.contains(one('[data-ui="chat-header"]')), 'the header sits outside the column').toBe(false)
  })

  test('each turn of the transcript is one [data-ui=turn] in the column, carrying its id (BRD-25.turn-gap measures 24 px between them)', () => {
    view(fixture(TWO_TURNS, { turns: TURNS }))
    const turns = [...one('[data-ui="chat-column"]').querySelectorAll<HTMLElement>('[data-ui="turn"]')]
    const ids = new Set(turns.map(turn => turn.getAttribute('data-turn-id')))
    expect([...ids].filter(Boolean).sort(), 'one per turn').toEqual(['u0', 'u1'])
  })

  test('[css] the prompt card is on the same left axis: nothing pushes it right or narrows it, and it reads as the card AG-10 drew', () => {
    view(fixture(TURN))
    const card = userCards()[0]
    for (const prop of ['margin-left', 'margin-inline-start']) expect(css(card, prop) ?? '', `${prop} never auto`).not.toMatch(/auto/)
    for (const prop of ['align-self', 'justify-self']) expect(css(card, prop) ?? '', `${prop} never end`).not.toMatch(/end|right/)
    expect(css(card, 'max-width') ?? 'none', 'no max-width under the column').toMatch(/^(none|100%)$/)
    expect(usesTok(css(card, ['background', 'background-color']), 'surface-raised'), 'background var(--surface-raised)').toBe(true)
    expect(usesTok(css(card, ['border', 'border-color']), 'bd-subtle'), 'border var(--bd-subtle)').toBe(true)
    expect(usesTok(css(card, 'border-radius'), 'radius-lg'), 'radius var(--radius-lg)').toBe(true)
    const padding = (css(card, 'padding') ?? '').split(/\s+(?![^(]*\))/).map(value => px(value))
    expect([padding[0], padding[1] ?? padding[0]], 'padding 12 / 16').toEqual([12, 16])
  })

  test.each(['en', 'pt-BR'] as const)('(%s) every prompt has Copy prompt, which copies exactly what the person sent', async locale => {
    await changeLanguage(locale)
    const f = fixture(TWO_TURNS, { turns: TURNS, api: { editPrompt: vi.fn(async () => undefined) } })
    view(f)
    const cards = userCards()
    for (const card of cards) expect(within(card).getAllByRole('button', { name: PAIRS.copy[locale] }), 'one Copy per prompt').toHaveLength(1)
    await userEvent.click(within(cards[1]).getByRole('button', { name: PAIRS.copy[locale] }))
    await waitFor(() => expect(f.clipboard.writeText).toHaveBeenCalledWith('Fix the login redirect'))
  })

  test('[css] the prompt card\'s actions wait for the pointer or the focus: hidden at rest, shown under hover and with focus inside', () => {
    view(fixture(TURN, { api: { editPrompt: vi.fn(async () => undefined) } }))
    const copy = within(userCards()[0]).getByRole('button', { name: PAIRS.copy.en })
    const bar = copy.parentElement!
    const hidden = (state: 'rest' | 'hover' | 'within'): boolean => {
      for (let node: Element | null = bar; node && node !== userCards()[0].parentElement; node = node.parentElement) {
        if (css(node, 'opacity', { state }) === '0' || css(node, 'visibility', { state }) === 'hidden') return true
      }
      return false
    }
    expect(hidden('rest'), 'hidden at rest').toBe(true)
    expect(hidden('hover'), 'shown under the pointer').toBe(false)
    expect(hidden('within'), 'shown with the focus inside').toBe(false)
  })

  test.each(['en', 'pt-BR'] as const)('(%s) Edit prompt is on the latest prompt only, and only when the window can edit; never while a turn runs', async locale => {
    await changeLanguage(locale)
    view(fixture(TWO_TURNS, { turns: TURNS, api: { editPrompt: vi.fn(async () => undefined) } }))
    const [older, latest] = userCards()
    expect(within(older).queryByRole('button', { name: PAIRS.edit[locale] }), 'an older prompt is history').toBeNull()
    expect(within(latest).getAllByRole('button', { name: PAIRS.edit[locale] })).toHaveLength(1)
    cleanup()
    view(fixture(TWO_TURNS, { turns: TURNS }))
    expect(screen.queryByRole('button', { name: PAIRS.edit[locale] }), 'no editPrompt in the window: no Edit').toBeNull()
    cleanup()
    view(fixture([...TWO_TURNS.slice(0, -1)], { status: 'running', turns: [TURNS[0], { ...TURNS[1], status: 'running' }], api: { editPrompt: vi.fn(async () => undefined) } }))
    expect(screen.queryByRole('button', { name: PAIRS.edit[locale] }), 'no Edit while the turn runs').toBeNull()
  })

  test('Edit opens the editor in the card with the text; Send asks main for the edit; Cancel leaves everything as it was', async () => {
    const editPrompt = vi.fn(async () => undefined)
    const f = fixture([msg('u1', 'user', 'Explain the login flow'), msg('a1', 'assistant', 'It posts to /login.'), done()], { turns: [{ id: 'u1', sequence: 1, status: 'completed', configuration: {} }], api: { editPrompt } })
    view(f)
    const card = userCards()[0]
    await userEvent.click(within(card).getByRole('button', { name: PAIRS.edit.en }))
    const box = within(userCards()[0]).getByRole('textbox')
    expect(box).toHaveValue('Explain the login flow')
    expect(within(userCards()[0]).queryByRole('checkbox', { name: PAIRS.undo.en }), 'a turn that changed no file: nothing to undo').toBeNull()
    await userEvent.click(within(userCards()[0]).getByRole('button', { name: tt('common.cancel') }))
    expect(within(userCards()[0]).queryByRole('textbox')).toBeNull()
    expect(editPrompt).not.toHaveBeenCalled()
    await userEvent.click(within(userCards()[0]).getByRole('button', { name: PAIRS.edit.en }))
    const editor = within(userCards()[0]).getByRole('textbox')
    await userEvent.clear(editor)
    await userEvent.type(editor, 'Explain the login flow, with the redirect')
    await userEvent.click(within(userCards()[0]).getByRole('button', { name: tt('composer.send') }))
    await waitFor(() => expect(editPrompt).toHaveBeenCalledWith('thread', 'u1', 'Explain the login flow, with the redirect', { restoreFiles: false }))
    expect(f.api.send, 'an edit is not a plain send').not.toHaveBeenCalled()
  })

  test.each(['en', 'pt-BR'] as const)('(%s) a turn that changed files offers to undo them, unchecked by default; checked, the edit restores them first', async locale => {
    await changeLanguage(locale)
    const editPrompt = vi.fn(async () => undefined)
    view(fixture(TURN, { turns: [TURNS[1]], api: { editPrompt } }))
    await userEvent.click(within(userCards()[0]).getByRole('button', { name: PAIRS.edit[locale] }))
    const undo = within(userCards()[0]).getByRole('checkbox', { name: PAIRS.undo[locale] })
    expect(undo, 'never undone without the person asking').not.toBeChecked()
    await userEvent.click(undo)
    await userEvent.click(within(userCards()[0]).getByRole('button', { name: tt('composer.send') }))
    await waitFor(() => expect(editPrompt).toHaveBeenCalledWith('thread', 'u1', 'Fix the login redirect', { restoreFiles: true }))
  })

  test.each(['en', 'pt-BR'] as const)('(%s) an edited prompt stays, marked Edited · resent below, with no Edit; the new prompt follows', async locale => {
    await changeLanguage(locale)
    const turns = [{ ...TURNS[0], editedInto: 'u1' }, TURNS[1]]
    view(fixture([msg('u0', 'user', 'Explain the login'), msg('a0', 'assistant', 'It posts.'), done(), ...TURN], { turns, api: { editPrompt: vi.fn(async () => undefined) } }))
    const [old, next] = userCards()
    expect(words(old)).toContain('Explain the login')
    expect(words(old), 'marked as edited').toContain(PAIRS.edited[locale])
    expect(within(old).queryByRole('button', { name: PAIRS.edit[locale] }), 'history: no Edit').toBeNull()
    expect(words(next)).toContain('Fix the login redirect')
    expect(words(next), 'the new prompt is a normal card').not.toContain(PAIRS.edited[locale])
    expect(screen.getByText('It posts.'), 'the old turn stays in view').toBeInTheDocument()
  })

  test('[css] the column is the generated --measure-chat token, and BRD-04.column.width measures the token (SOURCE-TEXT of the target data, marked)', () => {
    view(fixture(TURN))
    const column = one('[data-ui="chat-column"]')
    expect(usesTok(css(column, ['max-width', 'width', 'inline-size', 'max-inline-size']), 'measure-chat'), 'var(--measure-chat)').toBe(true)
    const measure = (JSON.parse(pbRead('src/design/targets/brd-04.json')) as { measures: Array<{ id: string; expect: Record<string, unknown> }> }).measures.find(item => item.id === 'BRD-04.column.width')
    expect(measure?.expect).toEqual({ token: '--measure-chat' })
  })

  test('adds the new pairs of words to both catalogs', () => {
    for (const [name, pair] of Object.entries(PAIRS)) expect(pairKey('thread', pair.en, pair['pt-BR']), `${name}: one key holds "${pair.en}" and "${pair['pt-BR']}"`).not.toBe('')
  })
})

describe('A5 · the empty conversation (row 1.0)', () => {
  test.each(['en', 'pt-BR'] as const)('(%s) the Ramo symbol, the title, the composer and exactly the four approved starters', async locale => {
    await changeLanguage(locale)
    view(fixture([]))
    const empty = await screen.findByTestId('thread-empty')
    const paths = [...empty.querySelectorAll('svg path')].map(path => path.getAttribute('d'))
    expect(paths, 'the Ramo mark of src/design/brand.ts').toContain(MARK_PATH)
    expect(within(empty).getByRole('heading')).toBeInTheDocument()
    const starters = threadStarters().map(starter => starter.label)
    expect(starters).toHaveLength(4)
    for (const label of starters) expect(within(empty).getAllByRole('button').filter(button => words(button).startsWith(label)), label).toHaveLength(1)
    expect(within(empty).getAllByRole('button'), 'nothing but the four starters').toHaveLength(4)
    expect(screen.getByRole('textbox', { name: tt('composer.message') })).toBeInTheDocument()
  })
})

const HEADER_THREAD = { id: 't1', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Fix login', pinned: false, status: 'idle', nativeSessionId: null, createdAt: 1, updatedAt: 1 } as ConversationThread
const OPEN_IN_CODE = { en: 'Open in OxeCode', 'pt-BR': 'Abrir no OxeCode' } as const
const OPEN_WORKTREE_IN_CODE = { en: 'Open the worktree in OxeCode', 'pt-BR': 'Abrir a worktree no OxeCode' } as const
const headerProps = (thread: ConversationThread, onOpenInCode: (path: string) => Promise<void>) => ({
  thread, pending: false, running: false, onCommand: () => {}, onDelegate: () => {}, onPin: () => {}, onExport: () => {}, onTogglePanel: () => {}, onOpenInCode
}) as unknown as Parameters<typeof ThreadHeader>[0]
async function openMenu(): Promise<HTMLElement> {
  fireEvent.keyDown(screen.getByRole('button', { name: tt('header.moreActions') }), { key: 'Enter' })
  return screen.findByRole('menu', { name: tt('header.moreActions') })
}

describe('A5 · Mais ações in four groups and Abrir no OxeCode (kept from F4 T10: BRD-21, brand 15/11)', () => {
  test.each(['en', 'pt-BR'] as const)('(%s) lists today\'s items in four groups, destructive last, Bifurcar disabled with its reason', async locale => {
    await changeLanguage(locale)
    render(<ThreadHeader {...headerProps(HEADER_THREAD, vi.fn(async () => undefined))} />)
    const menu = await openMenu()
    const groups: string[][] = [[]]
    for (const element of menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"], [role="separator"]')) {
      if (element.getAttribute('role') === 'separator') { if (groups.at(-1)!.length) groups.push([]) } else groups.at(-1)!.push(element.textContent?.trim() ?? '')
    }
    const expected = [['rename', 'pin', 'delegate', 'mcp'], ['largerText', 'showEveryToolCall', 'details'], ['openInCode', 'fork', 'export'], ['archive', 'delete']]
    const label = (key: string): string => key === 'openInCode' ? OPEN_IN_CODE[locale] : tt(`moreActions.${key}`)
    expect(groups.map(group => group.length), `groups ${JSON.stringify(groups)}`).toEqual(expected.map(group => group.length))
    expected.forEach((group, index) => group.forEach((key, position) =>
      expect(groups[index][position].startsWith(label(key)), `group ${index + 1}, item ${position + 1}: "${groups[index][position]}" is ${label(key)}`).toBe(true)))
    const fork = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.trim().startsWith(tt('moreActions.fork')))!
    expect(fork).toHaveAttribute('aria-disabled', 'true')
    expect(fork.textContent).toContain(tt('moreActions.forkCodexOnly'))
  })

  test.each(['en', 'pt-BR'] as const)('(%s) without a worktree it reads Abrir no OxeCode and opens the conversation\'s folder', async locale => {
    await changeLanguage(locale)
    const onOpenInCode = vi.fn(async () => undefined)
    render(<ThreadHeader {...headerProps(HEADER_THREAD, onOpenInCode)} />)
    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: OPEN_IN_CODE[locale] }))
    expect(onOpenInCode).toHaveBeenCalledWith('/repo')
  })

  test.each(['en', 'pt-BR'] as const)('(%s) with an owned worktree it reads Abrir a worktree no OxeCode and opens the worktree', async locale => {
    await changeLanguage(locale)
    const onOpenInCode = vi.fn(async () => undefined)
    const thread = { ...HEADER_THREAD, rootPath: '/repo-worktrees/fix-login', ownedWorktree: { path: '/repo-worktrees/fix-login', branch: 'fix/login', projectRoot: '/repo', baseSha: '0'.repeat(40), createdAt: 1 } } as ConversationThread
    render(<ThreadHeader {...headerProps(thread, onOpenInCode)} />)
    const menu = await openMenu()
    expect(within(menu).queryByRole('menuitem', { name: OPEN_IN_CODE[locale] }), 'one label, the worktree one').toBeNull()
    fireEvent.click(within(menu).getByRole('menuitem', { name: OPEN_WORKTREE_IN_CODE[locale] }))
    expect(onOpenInCode).toHaveBeenCalledWith('/repo-worktrees/fix-login')
  })

  test('adds the worktree label pair to the catalogs', () => {
    expect(pairKey('thread', OPEN_WORKTREE_IN_CODE.en, OPEN_WORKTREE_IN_CODE['pt-BR']), 'one key holds both texts').not.toBe('')
  })
})

describe('A5 · its brand measures', () => {
  test('turns its own BRD-04, BRD-05 and BRD-25 measures to enforced (SOURCE-TEXT check of the target data, marked)', () => {
    expect(notEnforced(MEASURES)).toEqual([])
  })

  test('the bubble measures AG-10 replaces stay pending, noted as replaced by BRD-25 (release of the coordinator 15/11; SOURCE-TEXT, marked)', () => {
    for (const id of REPLACED) {
      const measure = measureOf(id)
      expect(measure?.state, id).toBe('pending')
      expect(measure?.note ?? '', `${id} says it was replaced`).toMatch(/BRD-25/)
    }
  })
})
