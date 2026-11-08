// Frozen acceptance test for 1.5.0 A29 on screen (DESIGN U8.1, OXE program, phase F8, task FE-A29). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f8-design.md (U8.1).
// Contract (BACKEND #717 §A29): Agora reads only what is on main: window.oxe.agents { overview(), onChanged(cb), markSeen(key) }
// (S7.1, shared/types/agents.ts) plus F6's AgentRow.activity on conversation rows, and acts over existing IPC:
// thread.respond(threadId, requestId, response), thread.interrupt(threadId). F8 adds to AgentRequestSummary
// kind ('approval' | 'question') and reversible (boolean | null) (FRONTEND's add on #717). The renderer parts:
// - Agora({ onOpen(key), onSeeImpact(threadId, requestId), onAnswer(threadId, requestId), onNewConversation(), onOpenCode() })
//   in src/components/Agora/Agora.tsx;
// - agentStateWord(state, activity?) in src/components/Agora/agoraModel.ts (the phone's 7 words);
// - initialAppView(remembered) in src/app/startView.ts; AppView gains 'agora'; Ctrl Shift G is view.agora.
// U8.1d (mounted only while open, virtualized past ~60, the perf check) and U8.1e (themes, 900 × 620, axe) are the e2e run.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Row = Record<string, unknown>
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

const NOW = Date.now()
const min = (n: number) => NOW - n * 60_000
const OK = { ok: true, seq: 1 }
const SOURCES = { panes: OK, threads: OK, delegations: OK, work: OK }
const row = (id: string, extra: Row = {}): Row => ({
  kind: 'thread', id, state: 'working', provider: 'claude', mode: 'thread', title: id, workspaceId: 'ws-shop', since: min(5),
  seenAt: null, session: null, worktree: null, cost: null, requests: [], ...extra
})
// The request title is main's C3 (agents.request.*), so the cards are told apart by their conversation.
const request = (requestId: string, since: number, extra: Row = {}) => ({ requestId, title: { code: extra.kind === 'question' ? 'agents.request.question' : 'agents.request.approval', params: {} }, risk: 'low', answerable: true, since, kind: 'approval', reversible: true, ...extra })
const AGENTS = [
  row('t-pay', { title: 'Pix webhook', state: 'needs-you', since: min(31), requests: [request('q-1', min(31))] }),
  row('t-pub', { title: 'Release', state: 'needs-you', since: min(40), requests: [request('q-2', min(40), { risk: 'critical', reversible: false })] }),
  row('t-ask', { title: 'Schema', state: 'needs-you', since: min(10), workspaceId: 'ws-billing', requests: [request('q-3', min(10), { kind: 'question', risk: null, reversible: null })] }),
  row('t-work', { title: 'Refactor cart', state: 'working', activity: { kind: 'working', at: NOW, verb: 'edit', text: 'src/cart.ts' } }),
  row('d-1', { kind: 'delegation', mode: 'code', title: 'Write tests', state: 'working', parent: { kind: 'thread', id: 't-work' } }),
  row('p-1', { kind: 'pane', mode: 'code', provider: 'codex', title: 'Pane 2', state: 'idle' }),
  row('t-old', { title: 'Old task', state: 'finished', since: min(300), seenAt: min(200) }),
  row('t-new', { title: 'Fresh task', state: 'finished', since: min(3), seenAt: min(60) })
]
const WORKSPACES = [
  { id: 'ws-shop', name: 'shop', rootPath: '/repo/shop', themeId: 'midnight', panes: [] },
  { id: 'ws-billing', name: 'billing', rootPath: '/repo/billing', themeId: 'midnight', panes: [] }
]
function mockMain(overview: Row = { agents: AGENTS, sources: SOURCES }) {
  const listeners: Array<(change: unknown) => void> = []
  const agents = { overview: vi.fn(async () => overview), markSeen: vi.fn(async () => undefined), onChanged: vi.fn((listener: (change: unknown) => void) => { listeners.push(listener); return () => undefined }) }
  const thread = { respond: vi.fn(async () => undefined), interrupt: vi.fn(async () => undefined) }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, agents, thread } })
  return { agents, thread, change: (change: unknown) => act(() => { for (const listener of listeners) listener(change) }) }
}
async function renderAgora() {
  const { useWorkspaceStore } = await import('../../../src/store/workspace.store')
  act(() => useWorkspaceStore.setState({ workspaces: WORKSPACES as never }))
  const { Agora } = await load<{ Agora: (props: Row) => JSX.Element }>('src/components/Agora/Agora')
  const props = { onOpen: vi.fn(), onSeeImpact: vi.fn(), onAnswer: vi.fn(), onNewConversation: vi.fn(), onOpenCode: vi.fn() }
  render(<Agora {...props} />)
  await screen.findByRole('heading', { name: /Needs you|Nothing needs you|No agents running/ })
  return props
}
const cards = () => within(screen.getByRole('region', { name: 'Needs you' })).getAllByRole('article')

afterEach(async () => { cleanup(); await changeLanguage('en') })

describe('U8.1 · Agora, the start screen', () => {
  test('OxeSpace starts on Agora, and a remembered post, pods or any other view lands there too', async () => {
    const { initialAppView } = await load<{ initialAppView: (remembered: string | null) => string }>('src/app/startView')
    for (const remembered of [null, 'post', 'pods', 'code', 'thread', 'nonsense']) expect(initialAppView(remembered), String(remembered)).toBe('agora')
    const { APP_VIEWS } = await import('../../../src/keyboard/keybindings')
    expect(APP_VIEWS as readonly string[]).toContain('agora')
  })

  test('Ctrl Shift G opens Agora, and no other shortcut takes the chord', async () => {
    const { KEYBINDINGS } = await import('../../../src/keyboard/keybindings')
    expect(KEYBINDINGS.filter(binding => (binding.chords as readonly string[]).includes('Mod+Shift+G')).map(binding => binding.id as string)).toEqual(['view.agora'])
  })

  test('the needs-you cards come first, oldest first, each with its title, conversation, workspace and age, and the first is focused', async () => {
    mockMain()
    await renderAgora()
    const list = cards()
    expect(list.map(card => within(card).getByText(/^(Release|Pix webhook|Schema)$/).textContent)).toEqual(['Release', 'Pix webhook', 'Schema'])
    expect(within(list[1]).getByRole('heading', { name: 'Waiting for your approval' })).toBeInTheDocument()
    expect(within(list[2]).getByRole('heading', { name: 'Asking you a question' })).toBeInTheDocument()
    expect(within(list[1]).getByText('shop')).toBeInTheDocument()
    expect(within(list[1]).getByText('31 min')).toBeInTheDocument()
    await waitFor(() => expect(list[0].contains(document.activeElement)).toBe(true))
  })

  test('each card offers Deny first, then Allow, See impact or Answer by its request', async () => {
    mockMain()
    await renderAgora()
    const labels = (card: HTMLElement) => within(card).getAllByRole('button').map(button => button.textContent?.replace(/\s+[DA]$/, '').trim())
    const [publish, test1, question] = cards()
    expect(labels(publish)).toEqual(['Deny', 'See impact'])
    expect(labels(test1)).toEqual(['Deny', 'Allow'])
    expect(labels(question)[0]).toBe('Answer')
  })

  test('D on the focused card denies in one step, and focus goes to the next card, then to Nothing needs you', async () => {
    const main = mockMain({ agents: AGENTS.slice(0, 2), sources: SOURCES })
    await renderAgora()
    await waitFor(() => expect(cards()[0].contains(document.activeElement)).toBe(true))
    await userEvent.keyboard('d')
    expect(main.thread.respond).toHaveBeenCalledTimes(1)
    expect(main.thread.respond).toHaveBeenCalledWith('t-pub', 'q-2', { decision: 'decline' })
    main.change({ upsert: [{ ...AGENTS[1], state: 'working', requests: [] }], removed: [], sources: SOURCES })
    await waitFor(() => expect(cards()[0].contains(document.activeElement)).toBe(true))
    expect(within(cards()[0]).getByText('Pix webhook')).toBeInTheDocument()
    await userEvent.keyboard('d')
    main.change({ upsert: [{ ...AGENTS[0], state: 'working', requests: [] }], removed: [], sources: SOURCES })
    expect(await screen.findByText('Nothing needs you')).toHaveFocus()
  })

  test('A allows a reversible request in one step; on an irreversible one it opens the preview for the hold and approves nothing', async () => {
    const main = mockMain()
    const props = await renderAgora()
    await waitFor(() => expect(cards()[0].contains(document.activeElement)).toBe(true))
    await userEvent.keyboard('a')
    expect(main.thread.respond).not.toHaveBeenCalled()
    expect(props.onSeeImpact).toHaveBeenCalledWith('t-pub', 'q-2')
    await userEvent.keyboard('j')
    await userEvent.keyboard('a')
    expect(main.thread.respond).toHaveBeenCalledWith('t-pay', 'q-1', { decision: 'accept' })
  })

  test('on a question card D or A focuses its Answer, with the hint to answer in the conversation', async () => {
    const main = mockMain()
    await renderAgora()
    await waitFor(() => expect(cards()[0].contains(document.activeElement)).toBe(true))
    await userEvent.keyboard('jj')
    const question = cards()[2]
    expect(question.contains(document.activeElement)).toBe(true)
    await userEvent.keyboard('a')
    expect(within(question).getByRole('button', { name: /^Answer/ })).toHaveFocus()
    expect(within(question).getByText('Answer in the conversation')).toBeInTheDocument()
    expect(main.thread.respond).not.toHaveBeenCalled()
  })

  test('one group per workspace with its name and agent count; delegations nest under their parent', async () => {
    mockMain()
    await renderAgora()
    const shop = screen.getByRole('region', { name: /^shop/ })
    expect(within(shop).getByText(/\b\d+ agents\b/)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /^billing/ })).toBeInTheDocument()
    const parent = within(shop).getByText('Refactor cart').closest('li') as HTMLElement
    expect(within(parent).getByText('Write tests')).toBeInTheDocument()
  })

  test('a collapsed workspace keeps its needs-you dot', async () => {
    mockMain()
    await renderAgora()
    const shop = screen.getByRole('region', { name: /^shop/ })
    const toggle = within(shop).getByRole('button', { expanded: true })
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(shop).queryByText('Refactor cart')).toBeNull()
    expect(within(toggle).getByLabelText(/needs you/i)).toBeInTheDocument()
  })

  test('rows read the state word and the activity line; a finished row folds unless it finished since it was seen', async () => {
    mockMain()
    await renderAgora()
    const shop = screen.getByRole('region', { name: /^shop/ })
    const working = within(shop).getByText('Refactor cart').closest('li') as HTMLElement
    expect(within(working).getAllByText('Working').length).toBeGreaterThan(0)
    expect(within(working).getByText(/src\/cart\.ts/)).toBeInTheDocument()
    expect(within(shop).getByText('Fresh task')).toBeInTheDocument()
    expect(within(shop).queryByText('Old task')).toBeNull()
  })

  test('a pane shows its state and since, no model and no Stop, and offers Open the pane', async () => {
    mockMain()
    const props = await renderAgora()
    const pane = screen.getByText('Pane 2').closest('li') as HTMLElement
    expect(within(pane).getByText('Idle')).toBeInTheDocument()
    expect(within(pane).queryByRole('button', { name: /^Stop/ })).toBeNull()
    await userEvent.click(within(pane).getByRole('button', { name: 'Open the pane' }))
    expect(props.onOpen).toHaveBeenCalledWith({ kind: 'pane', id: 'p-1' })
  })

  test('Stop on a conversation asks first with Cancel focused, and only Stop stops it', async () => {
    const main = mockMain()
    await renderAgora()
    const working = screen.getByText('Refactor cart').closest('li') as HTMLElement
    await userEvent.click(within(working).getByRole('button', { name: /^Stop/ }))
    const confirm = await screen.findByRole('dialog')
    expect(within(confirm).getByText('Stop Refactor cart? The work so far is kept.')).toBeInTheDocument()
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(main.thread.interrupt).not.toHaveBeenCalled()
    await userEvent.click(within(working).getByRole('button', { name: /^Stop/ }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /^Stop/ }))
    expect(main.thread.interrupt).toHaveBeenCalledWith('t-work')
  })

  test('a source that could not be read shows one Notice with Try again, and the rest still shows', async () => {
    const main = mockMain({ agents: AGENTS, sources: { ...SOURCES, panes: { ok: false, reason: { code: 'agents.source.failed', params: {} } } } })
    await renderAgora()
    expect(screen.getAllByText('Some agents couldn\'t be read right now. The rest is up to date.')).toHaveLength(1)
    expect(screen.getByText('Refactor cart')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(main.agents.overview).toHaveBeenCalledTimes(2)
  })

  test('with no agents the empty state offers New conversation and Open OxeCode', async () => {
    mockMain({ agents: [], sources: SOURCES })
    const props = await renderAgora()
    expect(screen.getByText('No agents running. Start a conversation or an agent in OxeCode.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    await userEvent.click(screen.getByRole('button', { name: 'Open OxeCode' }))
    expect(props.onNewConversation).toHaveBeenCalledTimes(1)
    expect(props.onOpenCode).toHaveBeenCalledTimes(1)
  })

  test('exactly the phone\'s seven state words, with Ready for review under Finished', async () => {
    const { agentStateWord } = await load<{ agentStateWord: (state: string, activity?: Row) => string }>('src/components/Agora/agoraModel')
    const { AGENT_STATES } = await import('../../../shared/types/agents')
    expect(AGENT_STATES.map(state => agentStateWord(state))).toEqual(['Needs you', 'Failed', 'Working', 'Finished', 'Idle', 'Stopped', 'Not confirmed'])
    expect(agentStateWord('finished', { kind: 'ready', at: NOW })).toBe('Finished · Ready for review')
  })

  test('Agora reads in pt-BR', async () => {
    await changeLanguage('pt-BR')
    mockMain()
    const { useWorkspaceStore } = await import('../../../src/store/workspace.store')
    act(() => useWorkspaceStore.setState({ workspaces: WORKSPACES as never }))
    const { Agora } = await load<{ Agora: (props: Row) => JSX.Element }>('src/components/Agora/Agora')
    render(<Agora onOpen={vi.fn()} onSeeImpact={vi.fn()} onAnswer={vi.fn()} onNewConversation={vi.fn()} onOpenCode={vi.fn()} />)
    expect(await screen.findByRole('region', { name: 'Precisa de você' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir o painel' })).toBeInTheDocument()
    const { agentStateWord } = await load<{ agentStateWord: (state: string) => string }>('src/components/Agora/agoraModel')
    const { AGENT_STATES } = await import('../../../shared/types/agents')
    expect(AGENT_STATES.map(state => agentStateWord(state))).toEqual(['Precisa de você', 'Falhou', 'Trabalhando', 'Concluído', 'Ociosa', 'Parada', 'Não confirmado'])
  })
})
