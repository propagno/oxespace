// Frozen acceptance test for 1.5.2 OxeChat F5 · conversa AG-10/11, criterion A9 (task T9). Written by the planner; the
// executor must not edit it. Source: AG-11-CRITERIOS-F5.md row 5.1 (MARCA 15/11): "Lista numerada com StatusSignal por
// etapa, barra fina e '1/3'. 'Executar plano' só aparece quando a ação existe"; AG-10 §2.5 (the plan card "Plano de
// implementação · 1/3" with one "Executar plano" button) and board 3B (the Read only notice keeps "Mudar acesso");
// AG-11 §5.1. The action is T1's (thread.executePlan, shared/threadPlanExecution.ts planExecution): this task depends on T1.
// Today (main 12b8e900b): ThreadPlan is a <details> with icons (check, spinner, circle), "1/3 completed" and no way to
// run the plan; ThreadPlanOnlyHint says what Read only does and offers "Change access".
// Contract (src/components/Threads/ThreadPlan.tsx, ThreadPlanOnlyHint.tsx, ThreadTimelineEntry.tsx):
// - [data-ui=plan-card]: an <ol> of the steps, each led by a StatusSignal (completed → done, inProgress → working,
//   pending → waiting) whose label is the state word; a thin bar [role=progressbar] with aria-valuenow = done and
//   aria-valuemax = total; the count "1/3" (tabular-nums).
//   A plan is a decision (rule "Fechado ou aberto": human decisions open by default): the plan card stays in view
//   when the finished turn folds its work into "N ações" (threadTimelineModel.ts foldFinishedTurns keeps it).
// - "Run plan" / "Executar plano" (a new pair): exactly one, on the latest Plan turn, only when planExecution(snapshot,
//   turnId) is available AND the window has thread.executePlan; a click calls thread.executePlan(threadId, turnId) once
//   (and is disabled while it runs). A plan the agent wrote as prose (no plan event) gets the same one button at the end
//   of the turn. Never on an older turn, never while a turn runs, never in Agent mode.
// - Read only (planExecution reason 'read-only'): no Run plan; the turn keeps the hint and its "Change access" button.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAccountStore } from '../../../src/store/account.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
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
const RUN = { en: 'Run plan', 'pt-BR': 'Executar plano' } as const
const plan = (id: string, done = 1) => ({ type: 'plan', id, steps: [{ label: 'Read the refund flow', status: done >= 1 ? 'completed' : 'inProgress' }, { label: 'Add the idempotency key', status: done >= 1 ? 'inProgress' : 'pending' }, { label: 'Run the tests', status: 'pending' }] })
const planTurn = (id: string, over: Record<string, unknown> = {}) => ({ id, sequence: 1, status: 'completed', configuration: { mode: 'plan' }, ...over })
const PLAN_EVENTS = [msg('u1', 'user', 'Plan the Pix refund endpoint'), plan('plan:1'), msg('a1', 'assistant', 'Here is the plan.'), done()]
const view = (f: ReturnType<typeof fixture>) => render(<ThreadView workspace={f.workspace} />)
const runButtons = (locale: 'en' | 'pt-BR' = 'en'): HTMLElement[] => screen.queryAllByRole('button', { name: RUN[locale] })

beforeEach(() => { localStorage.clear() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('A9 · the plan card (row 5.1)', () => {
  test.each(['en', 'pt-BR'] as const)('(%s) a numbered list with a state signal per step, a thin bar and "1/3"', async locale => {
    await changeLanguage(locale)
    view(fixture(PLAN_EVENTS, { thread: { mode: 'plan' }, turns: [planTurn('u1')] }))
    const card = one('[data-ui="plan-card"]')
    const list = card.querySelector('ol')
    expect(list, 'a numbered list').toBeTruthy()
    const items = [...list!.querySelectorAll('li')]
    expect(items.map(item => item.querySelector('[data-ui="status-signal"]')?.getAttribute('data-state'))).toEqual(['done', 'working', 'waiting'])
    const bar = within(card).getByRole('progressbar')
    expect([bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax')]).toEqual(['1', '3'])
    expect(words(card)).toContain('1/3')
  })

  test.each(['en', 'pt-BR'] as const)('(%s) Run plan: one button on the latest Plan turn when the action exists; a click asks main to run it', async locale => {
    await changeLanguage(locale)
    let finish: () => void = () => {}
    const executePlan = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    view(fixture(PLAN_EVENTS, { thread: { mode: 'plan' }, turns: [planTurn('u1')], api: { executePlan } }))
    const buttons = runButtons(locale)
    expect(buttons).toHaveLength(1)
    await userEvent.click(buttons[0])
    expect(executePlan).toHaveBeenCalledTimes(1)
    expect(executePlan).toHaveBeenCalledWith('thread', 'u1')
    await waitFor(() => expect(runButtons(locale)[0]).toBeDisabled())
    await userEvent.click(runButtons(locale)[0])
    expect(executePlan, 'never twice').toHaveBeenCalledTimes(1)
    finish()
  })

  test('a plan written as prose (no plan event) gets the same one button at the end of the turn', () => {
    view(fixture([msg('u1', 'user', 'Plan the migration'), msg('a1', 'assistant', '1. Add the column\n2. Backfill\n3. Switch reads'), done()], { thread: { mode: 'plan' }, turns: [planTurn('u1')], api: { executePlan: vi.fn(async () => undefined) } }))
    expect(runButtons()).toHaveLength(1)
  })

  test('only when the action exists: not without thread.executePlan, not in Agent mode, not on an older turn, not while a turn runs', () => {
    view(fixture(PLAN_EVENTS, { thread: { mode: 'plan' }, turns: [planTurn('u1')] }))
    expect(runButtons(), 'no thread.executePlan in the window').toHaveLength(0)
    cleanup()
    view(fixture(PLAN_EVENTS, { thread: { mode: 'default' }, turns: [planTurn('u1')], api: { executePlan: vi.fn() } }))
    expect(runButtons(), 'the conversation left Plan').toHaveLength(0)
    cleanup()
    const later = [...PLAN_EVENTS, msg('u2', 'user', 'Thanks'), msg('a2', 'assistant', 'Sure.'), done()]
    view(fixture(later, { thread: { mode: 'plan' }, turns: [planTurn('u1'), planTurn('u2', { sequence: 2 })], api: { executePlan: vi.fn() } }))
    expect(runButtons(), 'the plan is on an older turn').toHaveLength(0)
    cleanup()
    view(fixture([...PLAN_EVENTS, msg('u2', 'user', 'Also lint')], { status: 'running', thread: { mode: 'plan' }, turns: [planTurn('u1'), planTurn('u2', { sequence: 2, status: 'running' })], api: { executePlan: vi.fn() } }))
    expect(runButtons(), 'a turn runs').toHaveLength(0)
  })

  test.each(['en', 'pt-BR'] as const)('(%s) in Read only there is no Run plan: the hint keeps Change access', async locale => {
    await changeLanguage(locale)
    view(fixture(PLAN_EVENTS, { thread: { mode: 'plan', access: 'read-only' }, turns: [planTurn('u1', { configuration: { mode: 'plan', access: 'read-only' } })], api: { executePlan: vi.fn() } }))
    expect(runButtons(locale)).toHaveLength(0)
    expect(screen.getByRole('button', { name: tt('planOnly.changeAccess') })).toBeInTheDocument()
  })

  test('adds Run plan / Executar plano to both catalogs', () => {
    expect(pairKey('thread', RUN.en, RUN['pt-BR'])).not.toBe('')
  })
})
