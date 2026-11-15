// Frozen acceptance test for 1.5.2 OxeChat F5 · conversa AG-10/11, criterion A12 (task T12). Written by the planner; the
// executor must not edit it. Source: AG-11-CRITERIOS-F5.md (MARCA 15/11) row "Barra do composer": on the left
// [Agente | Planejar] first and "+ Contexto" (the menu with @, image, / and MCP); on the right the model (the effort
// inside its popover), the access, the context ring without text (the percentage in the tooltip and aria-label) and
// Enviar or Parar; at narrow widths "+ Contexto" and Enviar/Parar stay visible at ≥ 24 px; Ctrl+/ opens the commands;
// AG-10 §2.5 and boards 7A–7C; AG-11 §5 item 3. It SUPERSEDES OxeChat F4 T11 (tests/oxe152/chat/oxc-2b-composer.test.tsx
// on oxe-152-chat-f4, never on main): kept from it, the composer card and toolbar hooks, the running controls, the
// container widths with the narrow "Configuração do turno" trigger (board 11, brand 15/11), the 560/420 container
// rules and its BRD-04 measures; rewritten, the order ("/" and Esforço leave the bar) and the medium layout (with the
// effort in the model's popover there is no Modelo+Esforço chip any more: full ≥ 420 px, narrow below).
// Today (main 12b8e900b): the composer is a form.thread-composer without data-ui; the bar reads "/", "+", Plan|Agent,
// Model, Effort, Permissions, ring, Send.
// Contract (src/components/Threads/ThreadComposerForm.tsx, ThreadConfigurationBar.tsx, ThreadUsageRing.tsx,
// ThreadComposerChrome.css; "[css]"/SOURCE-TEXT cases marked):
// - One [data-ui=composer] card with the Message textbox (composer.message) and one [data-ui=composer-toolbar].
// - The toolbar's first child is [data-ui=mode-switch]: two segments, "Agent" (config.agent) then "Plan"
//   (config.plan), with aria-pressed; they are not [data-ui=button] (the switch counts as one control).
// - Then "Context" / "Contexto" (a new pair; data-ui=button), whose menu holds Mention a file (composer.mention), Attach
//   image (composer.attach), the commands (composer.commands) and MCP servers (moreActions.mcp). No separate "/" or "+".
// - Right: the model chip (aria-label begins with config.chip.model); its popover holds the efforts (no Effort chip in the
//   bar); the access chip (aria-label begins with config.chip.permissions); the ring (aria-label usage.trigger "Usage: …",
//   no visible text); Send (composer.send) last. Idle, at most 6 [data-ui=button|icon-button] in the toolbar
//   (BRD-25.composer.controls). While a turn runs with text typed: Steer (composer.steer), Stop (composer.stopShort) and
//   Queue (composer.queue), no Send.
// - Width: the toolbar's data-width is "full" from 420 px of its container up (a ResizeObserver), "narrow" below: then the
//   model and the access are one trigger named "Turn settings" / "Configuração do turno" showing the current model,
//   and Context, Send/Stop stay. The column is a size container with an @container rule at 420 px (SOURCE-TEXT, marked).
// - Ctrl+/ in the message box opens the commands list (kept).
// - Measures: BRD-04.composer.radius, composer-toolbar.height, button.height, button.font-weight, icon-button.height and
//   BRD-25.composer.mode-first, composer.controls turn enforced.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
const CONTEXT = { en: 'Context', 'pt-BR': 'Contexto' } as const
const TURN_SETTINGS = { en: 'Turn settings', 'pt-BR': 'Configuração do turno' } as const
const MEASURES = ['BRD-04.composer.radius', 'BRD-04.composer-toolbar.height', 'BRD-04.button.height', 'BRD-04.button.font-weight', 'BRD-04.icon-button.height', 'BRD-25.composer.mode-first', 'BRD-25.composer.controls'] as const
const said = (el: Element): string => [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent].filter(Boolean).join(' ')
const controls = (toolbar: HTMLElement): HTMLElement[] => [...toolbar.querySelectorAll<HTMLElement>('button, [role="button"]')]
const indexOf = (list: HTMLElement[], word: string): number => list.findIndex(el => said(el).includes(word))
const startsWith = (list: HTMLElement[], word: string): HTMLElement[] => list.filter(el => (el.getAttribute('aria-label') ?? '').startsWith(word))
const view = (f: ReturnType<typeof fixture>) => render(<ThreadView workspace={f.workspace} />)
const RUNNING = { status: 'running' as const, turns: [{ id: 'u1', sequence: 1, status: 'running', configuration: {} }] }

/** jsdom measures nothing: every ResizeObserver reports `width` for its targets, the way a container query would see it. */
function observeWidth(width: number): { set(next: number): void } {
  const observers: Array<{ callback: ResizeObserverCallback; targets: Element[]; self: ResizeObserver }> = []
  const entry = (target: Element, size: number) => ({ target, contentRect: { width: size, height: 40, x: 0, y: 0, top: 0, left: 0, right: size, bottom: 40 },
    contentBoxSize: [{ inlineSize: size, blockSize: 40 }], borderBoxSize: [{ inlineSize: size, blockSize: 40 }], devicePixelContentBoxSize: [{ inlineSize: size, blockSize: 40 }] })
  let current = width
  class FakeResizeObserver {
    private readonly record: { callback: ResizeObserverCallback; targets: Element[]; self: ResizeObserver }
    constructor(callback: ResizeObserverCallback) { this.record = { callback, targets: [], self: this as unknown as ResizeObserver }; observers.push(this.record) }
    observe(target: Element): void { this.record.targets.push(target); this.record.callback([entry(target, current)] as unknown as ResizeObserverEntry[], this.record.self) }
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => current)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => current)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: current, height: 40, x: 0, y: 0, top: 0, left: 0, right: current, bottom: 40, toJSON: () => ({}) }) as DOMRect)
  return { set(next: number) { current = next; act(() => { for (const item of observers) item.callback(item.targets.map(target => entry(target, next)) as unknown as ResizeObserverEntry[], item.self) }) } }
}

beforeEach(() => { localStorage.clear() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); await changeLanguage('en') })

describe('A12 · the composer bar (AG-10 §2.5)', () => {
  test('one composer card with the Message box and one toolbar', () => {
    view(fixture([]))
    const composer = one('[data-ui="composer"]')
    expect(composer.contains(screen.getByRole('textbox', { name: tt('composer.message') }))).toBe(true)
    one('[data-ui="composer-toolbar"]', composer)
  })

  test.each(['en', 'pt-BR'] as const)('(%s) idle, the bar reads [Agent | Plan], Context, model, access, ring, Send; no "/", no "+", no Effort chip', async locale => {
    await changeLanguage(locale)
    view(fixture([]))
    const toolbar = one('[data-ui="composer-toolbar"]')
    const first = toolbar.firstElementChild as HTMLElement
    expect(first.getAttribute('data-ui'), 'the mode switch comes first').toBe('mode-switch')
    const segments = controls(first)
    expect(segments.map(el => el.textContent?.trim())).toEqual([tt('config.agent'), tt('config.plan')])
    for (const segment of segments) { expect(segment).toHaveAttribute('aria-pressed'); expect(segment.getAttribute('data-ui'), 'a segment is not a loose button').not.toBe('button') }
    const list = controls(toolbar).filter(el => !first.contains(el))
    const order = [indexOf(list, CONTEXT[locale]), list.indexOf(startsWith(list, tt('config.chip.model'))[0]), list.indexOf(startsWith(list, tt('config.chip.permissions'))[0]),
      list.indexOf(startsWith(list, tt('usage.trigger', { label: '\u0000' }).split('\u0000')[0])[0]), list.findIndex(el => nameOf(el) === tt('composer.send'))]
    expect(order.every(index => index >= 0), `all five: ${list.map(el => said(el).slice(0, 24)).join(' | ')}`).toBe(true)
    for (let index = 1; index < order.length; index++) expect(order[index - 1] < order[index], `order at ${index}: ${order.join(',')}`).toBe(true)
    expect(startsWith(list, tt('config.chip.effort')), 'the effort lives in the model popover').toEqual([])
    expect(list.filter(el => nameOf(el) === tt('composer.commands')), 'no loose "/"').toEqual([])
    expect(list.filter(el => nameOf(el) === tt('composer.add')), 'no loose "+"').toEqual([])
    const ring = startsWith(list, tt('usage.trigger', { label: '\u0000' }).split('\u0000')[0])[0]
    expect((ring.textContent ?? '').trim(), 'the ring shows no text: the percentage is in its tooltip and name').toBe('')
    expect([...toolbar.querySelectorAll('[data-ui="button"], [data-ui="icon-button"]')].length, 'at most 6 controls (BRD-25.composer.controls)').toBeLessThanOrEqual(6)
  })

  test('Context opens one menu with the file mention, the image, the commands and the MCP servers', async () => {
    view(fixture([]))
    const toolbar = one('[data-ui="composer-toolbar"]')
    await userEvent.click(controls(toolbar).find(el => said(el).includes(CONTEXT.en))!)
    const menu = await screen.findByRole('menu')
    const items = within(menu).getAllByRole('menuitem').map(item => item.textContent?.trim() ?? '')
    for (const label of [tt('composer.mention'), tt('composer.attach'), tt('composer.commands'), tt('moreActions.mcp')]) expect(items.some(item => item.startsWith(label)), `${label} in ${items.join(' | ')}`).toBe(true)
  })

  test('the model popover holds the efforts', async () => {
    view(fixture([]))
    const model = startsWith(controls(one('[data-ui="composer-toolbar"]')), tt('config.chip.model'))[0]
    await userEvent.click(model)
    expect(await screen.findByRole('button', { name: /^(High|Alto)/ })).toBeInTheDocument()
  })

  test('while a turn runs, with text typed: Steer, Stop and Queue are in the bar, and no Send', () => {
    view(fixture([msg('u1', 'user', 'Refactor the login')], RUNNING))
    fireEvent.change(screen.getByRole('textbox', { name: tt('composer.message') }), { target: { value: 'Also keep the old route' } })
    const list = controls(one('[data-ui="composer-toolbar"]'))
    for (const key of ['composer.steer', 'composer.stopShort', 'composer.queue']) expect(indexOf(list, tt(key)), `${key}`).toBeGreaterThanOrEqual(0)
    expect(list.filter(el => nameOf(el) === tt('composer.send')), 'no Send while a turn runs').toEqual([])
  })

  test('Ctrl+/ in the message box opens the commands', async () => {
    view(fixture([]))
    fireEvent.keyDown(screen.getByRole('textbox', { name: tt('composer.message') }), { key: '/', ctrlKey: true })
    expect(await screen.findByRole('listbox', { name: tt('commands.list') })).toBeInTheDocument()
  })
})

describe('A12 · the bar by container width (board 11, kept from F4 with the effort in the model)', () => {
  test.each([[600, 'full'], [419, 'narrow']] as const)('at %i px the toolbar is %s; Context and Send stay', (width, layout) => {
    observeWidth(width)
    view(fixture([]))
    const toolbar = one('[data-ui="composer-toolbar"]')
    expect(toolbar).toHaveAttribute('data-width', layout)
    const list = controls(toolbar)
    expect(indexOf(list, CONTEXT.en), 'Context stays').toBeGreaterThanOrEqual(0)
    expect(list.some(el => nameOf(el) === tt('composer.send')), 'Send stays').toBe(true)
    const model = startsWith(list, tt('config.chip.model')), access = startsWith(list, tt('config.chip.permissions'))
    if (layout === 'full') expect([model.length, access.length], 'model and access apart').toEqual([1, 1])
    else {
      const triggers = list.filter(el => el.getAttribute('aria-label') === tt(pairKey('thread', TURN_SETTINGS.en, TURN_SETTINGS['pt-BR'])))
      expect(triggers, 'one Turn settings trigger').toHaveLength(1)
      expect(triggers[0].textContent, 'it shows the current model').toContain('Native model')
      expect([...model, ...access], 'nothing else names the model or the access').toEqual([])
    }
  })

  test('narrow, while a turn runs with text typed, Stop and Queue stay with Context', () => {
    observeWidth(380)
    view(fixture([msg('u1', 'user', 'Refactor the login')], RUNNING))
    fireEvent.change(screen.getByRole('textbox', { name: tt('composer.message') }), { target: { value: 'Also keep the old route' } })
    const list = controls(one('[data-ui="composer-toolbar"]'))
    for (const word of [tt('composer.queue'), tt('composer.stopShort'), CONTEXT.en]) expect(indexOf(list, word), word).toBeGreaterThanOrEqual(0)
  })

  test('follows the column as it narrows, without a remount', () => {
    const width = observeWidth(620)
    view(fixture([]))
    expect(one('[data-ui="composer-toolbar"]')).toHaveAttribute('data-width', 'full')
    width.set(380)
    expect(one('[data-ui="composer-toolbar"]')).toHaveAttribute('data-width', 'narrow')
  })

  test('the conversation column is a size container with a 420 px rule in the OxeChat stylesheets (SOURCE-TEXT check, marked)', () => {
    const text = pbReaddir(pbJoin(process.cwd(), 'src/components/Threads')).filter(name => name.endsWith('.css')).map(name => pbRead(`src/components/Threads/${name}`)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(text).toMatch(/container-type\s*:\s*inline-size/)
    expect(text).toMatch(/@container[^{]*\b(419|420)(\.\d+)?px/)
  })

  test('adds Context and Turn settings to both catalogs', () => {
    expect(pairKey('thread', CONTEXT.en, CONTEXT['pt-BR']), 'Context').not.toBe('')
    expect(pairKey('thread', TURN_SETTINGS.en, TURN_SETTINGS['pt-BR']), 'Turn settings').not.toBe('')
  })

  test('turns its BRD-04 and BRD-25 measures to enforced (SOURCE-TEXT check of the target data, marked)', () => {
    expect(notEnforced(MEASURES)).toEqual([])
  })
})
