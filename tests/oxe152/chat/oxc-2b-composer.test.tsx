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
// - BRD-04 (PR #842): the card's measures are enforced and in enforced.lock.json (composer radius, toolbar height, the
//   button scale of the main area). BRD-05.new-composer.radius is measured in the new-conversation scene, so it is
//   OXC-3's (it lands after this card).
// Queries use data-ui, ARIA roles and the active catalog's strings.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
