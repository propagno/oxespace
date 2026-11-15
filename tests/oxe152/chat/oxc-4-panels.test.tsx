// Frozen acceptance test for 1.5.2 OxeChat F4 "UI" (OXE program oxespace-152-chat, phase F4, Jira OXE-169, OXC-4).
// Written by the planner; the executor must not edit it. Source: the written target v2 approved by the user on 15/11
// (oxechat-final-target.md, OXC-4 and the OXC-2 header, canvas board 2), the brand's note of 15/11 on the badge's name
// ("Alterações, N arquivos" / "Changes, N files"), the user's rule "mesmo padrão, tudo tem que sair como foi projetado na
// interface" and the coordinator's binding: the card's task adds data-ui="panel-toggle" on WorkbenchPanelToggle and turns
// ITS OWN measures of brd-04.json (PR #842) to enforced.
// Today (main 21704086d) the conversation has a tool tabs row (role=tablist, ThreadToolTabs) with a "+ Tool" menu, and the
// header shows only the Conversation details toggle; the panel width is one for every conversation.
// Contract (pixels are the conformance scene's job, marca/conformidade; this file pins structure, words and behaviour):
// - No rail: the [data-ui=chat-header] holds exactly four WorkbenchPanelToggle buttons, [data-ui=panel-toggle], in the
//   order of panelCatalog.THREAD_BAR_PANELS (Terminal, Alterações, Navegador, Detalhes da conversa; names from
//   code:panels.*), then the WorkbenchPanelMenu "Mais painéis" (code:panels.more), then Mais ações (thread:header.moreActions).
// - The tabs row and "+ Ferramenta" are gone: no role=tablist and no [data-ui=tabs] in the conversation, nothing named
//   thread:toolPanels.addTool.
// - The toggles open the existing DockPanels to the right, one at a time: the open one is aria-pressed="true", opening
//   another closes the first, clicking the open one closes it.
// - The Alterações toggle carries a badge with the number of FILES the conversation changed (what the Changes panel
//   lists): no badge at 0, "99+" above 99; its accessible name is "Changes, N files" / "Alterações, N arquivos", from the
//   plural pair panels.changesCount_one/_other (pt-BR also _many) this card adds (brand 15/11).
// - The panel width is remembered per conversation (thread-workbench store: a width set for one conversation does not
//   move another's, and it is persisted).
// - BRD-04 (PR #842): the card's measures are enforced and in enforced.lock.json, with the main area's raw-button count
//   (the tabs row this card removes held raw buttons; planner's assignment, asked of the coordination).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccountStore } from '../../../src/store/account.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useThreadWorkbenchStore } from '../../../src/store/thread-workbench.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { ThreadView } from '../../../src/components/Threads/ThreadView'
import { THREAD_BAR_PANELS, WORKBENCH_PANELS } from '../../../src/components/Workbench/panelCatalog'
import { changeLanguage, i18n } from '../../../src/i18n'
import type { Workspace } from '../../../shared/types/workspace'
import type { ThreadApi, ThreadEvent, ThreadSnapshot } from '../../../shared/types/thread'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'feat/thread', detached: false, shortSha: null, error: null }) }))

const ROOT = process.cwd()
const tt = (key: string, options: Record<string, unknown> = {}): string => i18n.t(key, { ns: 'thread', ...options }) as string
const tcode = (key: string): string => i18n.t(key, { ns: 'code' }) as string
function notEnforced(ids: readonly string[]): string[] {
  const dir = join(ROOT, 'src/design/targets')
  const lock = (JSON.parse(readFileSync(join(dir, 'enforced.lock.json'), 'utf8')) as { enforced: string[] }).enforced
  const measures = new Map(['brd-02', 'brd-04', 'brd-05'].flatMap(name => (JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as { measures: Array<{ id: string; state: string }> }).measures).map(item => [item.id, item.state]))
  return ids.flatMap(id => [...(!measures.has(id) ? [`${id} is not in src/design/targets`] : measures.get(id) === 'enforced' ? [] : [`${id} is ${measures.get(id)}`]), ...(lock.includes(id) ? [] : [`${id} is not in enforced.lock.json`])])
}
const OXC4_MEASURES = ['BRD-04.tabs.count', 'BRD-04.panel-toggle.height', 'BRD-04.panel-toggle.count', 'BRD-04.raw-button.count'] as const

/** A finished turn that changed `count` files, as tool evidence and as the conversation's places. */
function changedFiles(count: number): { events: ThreadEvent[]; files: string[] } {
  const files = Array.from({ length: count }, (_, index) => `src/file-${index}.ts`)
  return { files, events: [
    { type: 'message', id: 'u1', role: 'user', text: 'Touch the files' },
    ...(count ? [{ type: 'tool', id: 't1', name: 'Edit', state: 'completed', detail: 'many files', files: files.map(path => ({ path: `/repo/${path}`, kind: 'update', source: 'native-patch', state: 'completed', additions: 1, deletions: 0 })) }] : []),
    { type: 'completed', status: 'completed' }
  ] as ThreadEvent[] }
}
function fixture(count = 0) {
  const { events, files } = changedFiles(count)
  const snapshot: ThreadSnapshot = { thread: { id: 'thread', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Auth investigation', pinned: false, status: 'idle', nativeSessionId: 'native-1', createdAt: 1, updatedAt: 1 }, events }
  const places = { places: count ? [{ id: 'root', kind: 'root', path: '/repo', firstSeenAt: 1, base: null, current: null, drift: null, writes: count, files }] : [], capped: false, refused: 0 }
  const api = { commands: vi.fn(async () => ({ commands: [] })), projects: vi.fn(async () => ({ projects: [], unavailable: [] })), list: vi.fn(async () => [snapshot.thread]), read: vi.fn(async () => snapshot),
    models: vi.fn(async () => ({ defaultModel: 'native-model', models: [] })), configure: vi.fn(async () => snapshot), send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), pin: vi.fn(async () => {}), onChanged: vi.fn(() => () => {}),
    places: vi.fn(async () => places), onPlacesChanged: vi.fn(() => () => {}), toolTabs: vi.fn(async () => [{ id: 'queries' }]) } as unknown as ThreadApi
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api, clipboard: { writeText: vi.fn(async () => true) }, agentAccount: { read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 })) } } })
  const workspace = { id: 'ws', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useThreadStore.setState({ threads: [snapshot.thread], projects: [{ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }], snapshot, selectedId: 'thread', secondaryId: null } as never)
  useThreadWorkbenchStore.setState({ views: {}, maximizedId: null })
  return { snapshot, workspace }
}
const header = (): HTMLElement => {
  const found = [...document.querySelectorAll<HTMLElement>('[data-ui="chat-header"]')]
  expect(found, 'one chat-header').toHaveLength(1)
  return found[0]
}
const toggles = (): HTMLElement[] => [...header().querySelectorAll<HTMLElement>('[data-ui="panel-toggle"]')]
const nameOf = (el: Element): string => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim()
const before = (a: Node, b: Node): boolean => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
const changes = (): HTMLElement => toggles()[THREAD_BAR_PANELS.indexOf('changes')]

beforeEach(() => { localStorage.clear() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-169 OXC-4 panels from the header (A14)', () => {
  it.each(['en', 'pt-BR'])('the header (%s) holds the four panel toggles in catalog order, then Mais painéis, then Mais ações', async locale => {
    await changeLanguage(locale)
    const f = fixture()
    render(<ThreadView workspace={f.workspace} />)
    const list = toggles()
    expect(list.map(nameOf), 'four toggles, THREAD_BAR_PANELS order').toHaveLength(4)
    THREAD_BAR_PANELS.forEach((id, index) => expect(nameOf(list[index]).startsWith(WORKBENCH_PANELS[id].label), `toggle ${index} is ${WORKBENCH_PANELS[id].label}: "${nameOf(list[index])}"`).toBe(true))
    const more = within(header()).getByRole('button', { name: new RegExp(`^${tcode('panels.more').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
    const actions = within(header()).getByRole('button', { name: tt('header.moreActions') })
    expect(before(list[3], more) && before(more, actions), 'toggles, then Mais painéis, then Mais ações').toBe(true)
  })

  it('removes the tabs row and "+ Ferramenta"', () => {
    const f = fixture()
    render(<ThreadView workspace={f.workspace} />)
    expect(document.querySelectorAll('[role="tablist"], [data-ui="tabs"]'), 'no tabs in the conversation').toHaveLength(0)
    const addTool = tt('toolPanels.addTool').replace(/^\+\s*/, '')
    expect(screen.queryAllByRole('button').filter(button => nameOf(button).replace(/^\+\s*/, '') === addTool)).toEqual([])
  })

  it('opens one panel at a time: the open toggle is pressed, another closes it, the same one closes it', () => {
    const f = fixture()
    render(<ThreadView workspace={f.workspace} />)
    const pressed = (): string[] => toggles().filter(el => el.getAttribute('aria-pressed') === 'true').map(nameOf)
    const at = (id: string): HTMLElement => toggles()[THREAD_BAR_PANELS.indexOf(id as never)]
    fireEvent.click(at('changes'))
    expect(pressed()).toEqual([nameOf(at('changes'))])
    fireEvent.click(at('browser'))
    expect(pressed()).toEqual([nameOf(at('browser'))])
    fireEvent.click(at('browser'))
    expect(pressed()).toEqual([])
  })

  it.each([['en', 'Changes, 3 files'], ['pt-BR', 'Alterações, 3 arquivos']])('the Alterações badge (%s) counts the files and names them', async (locale, name) => {
    await changeLanguage(locale)
    const f = fixture(3)
    render(<ThreadView workspace={f.workspace} />)
    await screen.findByRole('button', { name })
    expect(changes()).toHaveAccessibleName(name)
    expect(changes().textContent).toContain('3')
  })

  it('shows no badge at 0 and "99+" above 99', async () => {
    const zero = fixture(0)
    const first = render(<ThreadView workspace={zero.workspace} />)
    expect(changes()).toHaveAccessibleName(WORKBENCH_PANELS.changes.label)
    expect(changes().textContent ?? '').not.toMatch(/\d/)
    first.unmount()
    const many = fixture(150)
    render(<ThreadView workspace={many.workspace} />)
    await screen.findByRole('button', { name: 'Changes, 150 files' })
    expect(changes().textContent).toContain('99+')
  })

  it('adds the badge name as the plural pair panels.changesCount in en and pt-BR', () => {
    const flat = (value: unknown, prefix = ''): Record<string, string> => Object.assign({}, ...Object.entries(value as Record<string, unknown>).map(([key, item]) =>
      typeof item === 'string' ? { [prefix + key]: item } : flat(item, `${prefix}${key}.`)))
    const pair = (locale: string): Record<string, string | undefined> => {
      const found = ['thread', 'code'].map(ns => flat(JSON.parse(readFileSync(join(ROOT, `shared/locales/${locale}/${ns}.json`), 'utf8')))).find(keys => 'panels.changesCount_one' in keys) ?? {}
      return { one: found['panels.changesCount_one'], other: found['panels.changesCount_other'], many: found['panels.changesCount_many'] }
    }
    expect(pair('en')).toMatchObject({ one: 'Changes, {{count}} file', other: 'Changes, {{count}} files' })
    expect(pair('pt-BR')).toEqual({ one: 'Alterações, {{count}} arquivo', other: 'Alterações, {{count}} arquivos', many: 'Alterações, {{count}} arquivos' })
  })

  it('remembers the panel width per conversation, persisted', () => {
    useThreadWorkbenchStore.setState({ views: {} })
    useThreadWorkbenchStore.getState().setView('one', { panel: 'changes', width: 520 } as never)
    useThreadWorkbenchStore.getState().setView('two', { panel: 'changes', width: 760 } as never)
    const views = useThreadWorkbenchStore.getState().views as Record<string, { width?: number }>
    expect([views.one?.width, views.two?.width]).toEqual([520, 760])
    const persisted = JSON.stringify(useThreadWorkbenchStore.persist.getOptions().partialize?.(useThreadWorkbenchStore.getState()))
    for (const part of ['one', '520', 'two', '760']) expect(persisted, `persisted state holds ${part}`).toContain(part)
  })

  it('turns its own BRD-04 measures to enforced', () => {
    expect(notEnforced(OXC4_MEASURES)).toEqual([])
  })
})
