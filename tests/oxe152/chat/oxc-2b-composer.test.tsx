// Frozen acceptance test for 1.5.2 OxeChat F4 "UI" (OXE program oxespace-152-chat, phase F4, Jira OXE-172, OXC-2b "Caixa de mensagem",
// the card the brand split from OXE-167 on 15/11). Written by the planner; the executor must not edit it. Source: the
// written target v2 approved by the user on 15/11 (oxechat-final-target.md, OXC-2 "Composer" and "Popovers", board 8),
// the user's rule "mesmo padrão, tudo tem que sair como foi projetado na interface" and the coordinator's binding: the
// card's task adds the data-ui its measures read and turns ITS OWN measures of brd-04.json (PR #842) to enforced.
// Today (main 21704086d) the composer is a form.thread-composer with no data-ui and a hand-made toolbar.
// Contract (pixels are the conformance scenes' job, marca/conformidade; this file pins structure, words and behaviour):
// - One [data-ui=composer] card inside the conversation's [data-ui=chat-column] (the column of OXC-2), holding the
//   Message textbox (thread:composer.message) and one [data-ui=composer-toolbar].
// - Idle, the toolbar reads left to right: "/" (thread:composer.commands), the Planejar/Agente mode (thread:config.plan
//   or config.agent), Modelo (thread:config.chip.model), Esforço (thread:config.chip.effort), Acesso (thread:config.access)
//   and Enviar (thread:composer.send); every control in it is a src/ui primitive ([data-ui=button|icon-button]).
// - While a turn runs, with text typed: Orientar o turno ativo (thread:composer.steer), Parar (thread:composer.stopShort)
//   and Pôr na fila (thread:composer.queue) are in the toolbar, and Enviar is not.
// - Board 11 (brand 15/11, Antigravity AG-06): the toolbar adapts to the width of the conversation column. The column is a
//   size container (container-type: inline-size) with @container rules at 560 and 420 px in the OxeChat stylesheets,
//   src/components/Threads (SOURCE-TEXT check, marked; other surfaces already query 560 px), and
//   the toolbar says which layout it is in as data-width, from its container's inline size (a ResizeObserver): "full" at
//   560 px and above (boards 1 and 8: Modelo, Esforço and Acesso apart), "medium" from 420 to 559 (Modelo and Esforço in one
//   chip with one popover; Acesso apart), "narrow" below 420 (Modelo, Esforço and Acesso in one "configuração do turno"
//   popover). At every width "/" (thread:composer.commands) and Enviar (thread:composer.send) stay in the toolbar, and every
//   control is a src/ui primitive (the 24 px floor of the target-size lint). jsdom has no layout: the width is fed through
//   the observer and the test reads data-width and which controls exist.
// - BRD-04 (PR #842): the card's measures are enforced and in enforced.lock.json (composer radius, toolbar height, the
//   button scale of the main area). BRD-05.new-composer.radius is measured in the new-conversation scene, so it is
//   OXC-3's (it lands after this card).
// Queries use data-ui, ARIA roles and the active catalog's strings.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccountStore } from '../../../src/store/account.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { ThreadView } from '../../../src/components/Threads/ThreadView'
import { changeLanguage, i18n } from '../../../src/i18n'
import type { Workspace } from '../../../shared/types/workspace'
import type { ThreadApi, ThreadEvent, ThreadSnapshot, ThreadStatus } from '../../../shared/types/thread'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'feat/thread', detached: false, shortSha: null, error: null }) }))

const ROOT = process.cwd()
const tt = (key: string, options: Record<string, unknown> = {}): string => i18n.t(key, { ns: 'thread', ...options }) as string
function notEnforced(ids: readonly string[]): string[] {
  const dir = join(ROOT, 'src/design/targets')
  const lock = (JSON.parse(readFileSync(join(dir, 'enforced.lock.json'), 'utf8')) as { enforced: string[] }).enforced
  const measures = new Map(['brd-02', 'brd-04', 'brd-05'].flatMap(name => (JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as { measures: Array<{ id: string; state: string }> }).measures).map(item => [item.id, item.state]))
  return ids.flatMap(id => [...(!measures.has(id) ? [`${id} is not in src/design/targets`] : measures.get(id) === 'enforced' ? [] : [`${id} is ${measures.get(id)}`]), ...(lock.includes(id) ? [] : [`${id} is not in enforced.lock.json`])])
}
const OXC2B_MEASURES = ['BRD-04.composer.radius', 'BRD-04.composer-toolbar.height', 'BRD-04.button.height', 'BRD-04.button.font-weight', 'BRD-04.icon-button.height'] as const

function fixture(status: ThreadStatus, events: ThreadEvent[] = []) {
  const snapshot: ThreadSnapshot = { thread: { id: 'thread', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Auth investigation', pinned: false, status, nativeSessionId: 'native-1', createdAt: 1, updatedAt: 1, access: 'full-access' }, events }
  const api = { commands: vi.fn(async () => ({ commands: [] })), projects: vi.fn(async () => ({ projects: [], unavailable: [] })), list: vi.fn(async () => [snapshot.thread]), create: vi.fn(async () => snapshot), read: vi.fn(async () => snapshot),
    models: vi.fn(async () => ({ defaultModel: 'native-model', models: [{ id: 'native-model', label: 'Native model', description: '', efforts: ['low', 'high'], defaultEffort: 'low' }] })),
    configure: vi.fn(async () => snapshot), send: vi.fn(async () => {}), steer: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), pin: vi.fn(async () => {}), onChanged: vi.fn(() => () => {}),
    places: vi.fn(async () => ({ places: [], capped: false, refused: 0 })), onPlacesChanged: vi.fn(() => () => {}) } as unknown as ThreadApi
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api, clipboard: { writeText: vi.fn(async () => true) }, agentAccount: { read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 })) } } })
  const workspace = { id: 'ws', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useThreadStore.setState({ threads: [snapshot.thread], projects: [{ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }], snapshot, selectedId: 'thread', secondaryId: null } as never)
  return { snapshot, api, workspace }
}
const one = (selector: string, root: ParentNode = document): HTMLElement => {
  const found = [...root.querySelectorAll<HTMLElement>(selector)]
  expect(found, `exactly one ${selector}`).toHaveLength(1)
  return found[0]
}
/** Everything a control says about itself: its name, its tooltip and its visible text. */
const said = (el: Element): string => [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent].filter(Boolean).join(' ')
const controls = (toolbar: HTMLElement): HTMLElement[] => [...toolbar.querySelectorAll<HTMLElement>('button, [role="button"]')]
const indexOf = (list: HTMLElement[], word: string): number => list.findIndex(el => said(el).includes(word))

beforeEach(() => { localStorage.clear() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-172 OXC-2b composer (A12)', () => {
  it('is one composer card inside the chat column, with the Message box and one toolbar', () => {
    const f = fixture('idle')
    render(<ThreadView workspace={f.workspace} />)
    const composer = one('[data-ui="composer"]', one('[data-ui="chat-column"]'))
    expect(composer.contains(screen.getByRole('textbox', { name: tt('composer.message') }))).toBe(true)
    one('[data-ui="composer-toolbar"]', composer)
  })

  it.each(['en', 'pt-BR'])('idle (%s), the toolbar reads "/", mode, Modelo, Esforço, Acesso, Enviar, all primitives', async locale => {
    await changeLanguage(locale)
    const f = fixture('idle')
    render(<ThreadView workspace={f.workspace} />)
    const toolbar = one('[data-ui="composer-toolbar"]')
    const list = controls(toolbar)
    for (const el of list) expect(['button', 'icon-button'], `toolbar control "${said(el).slice(0, 40)}"`).toContain(el.getAttribute('data-ui'))
    const mode = Math.max(indexOf(list, tt('config.plan')), indexOf(list, tt('config.agent')))
    const order = [indexOf(list, tt('composer.commands')), mode, indexOf(list, tt('config.chip.model')), indexOf(list, tt('config.chip.effort')), indexOf(list, tt('config.access')), indexOf(list, tt('composer.send'))]
    expect(order.every(index => index >= 0), `all six in the toolbar: ${list.map(el => said(el).slice(0, 24)).join(' | ')}`).toBe(true)
    for (let index = 1; index < order.length; index++) expect(order[index - 1] < order[index], `toolbar order at ${index}: ${order.join(',')}`).toBe(true)
  })

  it('while a turn runs, with text typed, the toolbar has Orientar, Parar and Pôr na fila, and no Enviar', () => {
    const f = fixture('running', [{ type: 'message', id: 'u1', role: 'user', text: 'Refactor the login' } as ThreadEvent])
    render(<ThreadView workspace={f.workspace} />)
    fireEvent.change(screen.getByRole('textbox', { name: tt('composer.message') }), { target: { value: 'Also keep the old route' } })
    const list = controls(one('[data-ui="composer-toolbar"]'))
    for (const key of ['composer.steer', 'composer.stopShort', 'composer.queue']) expect(indexOf(list, tt(key)), `${key} in the toolbar`).toBeGreaterThanOrEqual(0)
    expect(list.filter(el => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim() === tt('composer.send')), 'no Enviar while a turn runs').toEqual([])
  })

  it('turns its own BRD-04 measures to enforced', () => {
    expect(notEnforced(OXC2B_MEASURES)).toEqual([])
  })
})

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
const mentions = (list: HTMLElement[], words: string[]): HTMLElement[] => list.filter(el => words.some(word => said(el).includes(word)))

describe('OXE-172 OXC-2b composer toolbar by container width, board 11 (A12)', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it.each([[600, 'full'], [500, 'medium'], [400, 'narrow']] as const)('at %i px the toolbar is %s, and "/" and Enviar stay', async (width, layout) => {
    observeWidth(width)
    const f = fixture('idle')
    render(<ThreadView workspace={f.workspace} />)
    const toolbar = one('[data-ui="composer-toolbar"]')
    expect(toolbar).toHaveAttribute('data-width', layout)
    const list = controls(toolbar)
    for (const el of list) expect(['button', 'icon-button'], `toolbar control "${said(el).slice(0, 40)}"`).toContain(el.getAttribute('data-ui'))
    expect(indexOf(list, tt('composer.commands')), '"/" stays').toBeGreaterThanOrEqual(0)
    expect(indexOf(list, tt('composer.send')), 'Enviar stays').toBeGreaterThanOrEqual(0)
    const model = tt('config.chip.model'), effort = tt('config.chip.effort'), access = tt('config.access')
    const modelOrEffort = mentions(list, [model, effort]), anyConfig = mentions(list, [model, effort, access])
    if (layout === 'full') {
      expect([indexOf(list, model), indexOf(list, effort), indexOf(list, access)].every(index => index >= 0), 'Modelo, Esforço and Acesso apart').toBe(true)
      expect(new Set(anyConfig).size, 'three separate controls').toBeGreaterThanOrEqual(3)
    }
    if (layout === 'medium') {
      expect(modelOrEffort, 'Modelo and Esforço are one chip').toHaveLength(1)
      expect(mentions(list, [access]).filter(el => !modelOrEffort.includes(el)), 'Acesso stays apart').toHaveLength(1)
    }
    if (layout === 'narrow') expect(anyConfig, 'Modelo, Esforço and Acesso are one popover trigger').toHaveLength(1)
  })

  it('follows the column as it narrows, without a remount', () => {
    const width = observeWidth(620)
    const f = fixture('idle')
    render(<ThreadView workspace={f.workspace} />)
    expect(one('[data-ui="composer-toolbar"]')).toHaveAttribute('data-width', 'full')
    width.set(480)
    expect(one('[data-ui="composer-toolbar"]')).toHaveAttribute('data-width', 'medium')
    width.set(380)
    expect(one('[data-ui="composer-toolbar"]')).toHaveAttribute('data-width', 'narrow')
  })

  it('makes the conversation column a size container with breakpoints at 560 and 420 px in the OxeChat stylesheets (SOURCE-TEXT check, marked)', () => {
    const css = (dir: string): string[] => readdirSync(dir).flatMap(name => { const full = join(dir, name); return statSync(full).isDirectory() ? css(full) : name.endsWith('.css') ? [full] : [] })
    const text = css(join(ROOT, 'src/components/Threads')).map(file => readFileSync(file, 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(text, 'a container-type: inline-size rule').toMatch(/container-type\s*:\s*inline-size/)
    expect(text, 'an @container rule at 560 px').toMatch(/@container[^{]*\b(559|560)(\.\d+)?px/)
    expect(text, 'an @container rule at 420 px').toMatch(/@container[^{]*\b(419|420)(\.\d+)?px/)
  })
})
