// Frozen acceptance test for 1.5.2 OxeChat F5 · conversa AG-10/11, criterion A13 (task T13). Written by the planner; the
// executor must not edit it. Source: AG-11-CRITERIOS-F5.md (MARCA 15/11) row "Barra de trabalho do turno": joined to the
// top of the composer, "▾ N arquivos alterados +A −R" and "Ver alterações"; it shows only when the conversation changed
// files, and its number is the Changes badge's (OXE-169); AG-10 §2.3 (the working-set bar of VS Code Agent / Copilot
// Edits: a click opens the list of touched files in place) and board 7A. Depends on T12 (the composer card).
// Today (main 12b8e900b): ThreadDockChanges is a separate dock above the composer reading "N files changed · not reviewed
// yet" with Keep all / Undo all / Review, no totals, no hook.
// Contract (src/components/Threads/ThreadDockChanges.tsx and the composer's stylesheet):
// - [data-ui=working-set] inside the [data-ui=composer] card, before the Message box (joined to its top), only when the
//   conversation's finished turns left files pending (thread.turnFiles state 'pending', the same source the Changes
//   panel counts; T13 does not add the OXE-169 badge, which reads it too). Its toggle button (aria-expanded=false at rest)
//   reads "2 files changed +128 −6" / "2 arquivos alterados +128 −6" (dockChanges.files and the summed additions and
//   deletions); opened, the files are listed in place with their own +/− ; "View changes" / "Ver alterações"
//   (files.view or a new pair) opens the conversation's Changes panel. Keep and Undo stay reachable for each file.
// - No working-set when nothing is pending. BRD-25.working-set.height (--bar-sm) turns enforced.
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
const SUMMARY = { en: '2 files changed +128 −6', 'pt-BR': '2 arquivos alterados +128 −6' } as const
const VIEW = { en: 'View changes', 'pt-BR': 'Ver alterações' } as const
const FILES = [{ path: 'src/pix/refund.ts', state: 'pending', preExists: true, postExists: true, additions: 86, deletions: 6 }, { path: 'tests/pix/refund.test.ts', state: 'pending', preExists: false, postExists: true, additions: 42, deletions: 0 }]
const EVENTS = [msg('u1', 'user', 'Make refunds idempotent'), msg('a1', 'assistant', 'Done.'), done()]
const TURNS = [{ id: 'u1', sequence: 1, status: 'completed', configuration: {} }]
const view = (f: ReturnType<typeof fixture>) => render(<ThreadView workspace={f.workspace} />)

beforeEach(() => { localStorage.clear() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('A13 · the working-set bar on top of the composer (AG-10 §2.3)', () => {
  test.each(['en', 'pt-BR'] as const)('(%s) inside the composer card, before the message box: "2 files changed +128 −6", closed', async locale => {
    await changeLanguage(locale)
    view(fixture(EVENTS, { turns: TURNS, api: { turnFiles: vi.fn(async () => FILES) } }))
    const bar = await waitFor(() => one('[data-ui="working-set"]'))
    const composer = one('[data-ui="composer"]')
    expect(composer.contains(bar), 'joined to the composer').toBe(true)
    const box = screen.getByRole('textbox', { name: tt('composer.message') })
    expect(Boolean(bar.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING), 'on top of the message box').toBe(true)
    const toggle = within(bar).getAllByRole('button').find(button => button.hasAttribute('aria-expanded'))!
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(words(toggle)).toBe(SUMMARY[locale])
  })

  test('opened, the files are listed in place with their lines; View changes opens the Changes panel', async () => {
    view(fixture(EVENTS, { turns: TURNS, api: { turnFiles: vi.fn(async () => FILES) } }))
    const bar = await waitFor(() => one('[data-ui="working-set"]'))
    const toggle = within(bar).getAllByRole('button').find(button => button.hasAttribute('aria-expanded'))!
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    for (const [name, lines] of [['src/pix/refund.ts', /\+86\s*[−-]6/], ['tests/pix/refund.test.ts', /\+42/]] as const) {
      const row = [...bar.querySelectorAll<HTMLElement>('li, [role="listitem"], [data-ui="working-set-file"]')].find(node => words(node).includes(name))
      expect(row, name).toBeTruthy()
      expect(words(row), name).toMatch(lines)
    }
    await userEvent.click(within(bar).getByRole('button', { name: VIEW.en }))
    expect(useThreadWorkbenchStore.getState().views.thread?.panel).toBe('changes')
  })

  test('nothing pending, no bar', async () => {
    const turnFiles = vi.fn(async () => FILES.map(file => ({ ...file, state: 'reverted' })))
    view(fixture(EVENTS, { turns: TURNS, api: { turnFiles } }))
    await waitFor(() => expect(turnFiles).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(document.querySelector('[data-ui="working-set"]')).toBeNull()
  })

  test('adds View changes / Ver alterações to the catalogs (or reuses a key that holds both)', () => {
    expect(pairKey('thread', VIEW.en, VIEW['pt-BR'])).not.toBe('')
  })

  test('turns BRD-25.working-set.height to enforced (SOURCE-TEXT check of the target data, marked)', () => {
    expect(notEnforced(['BRD-25.working-set.height'])).toEqual([])
  })
})
