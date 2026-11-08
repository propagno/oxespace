// Frozen acceptance test for 1.5.0 A53 on the desktop (DESIGN U6.6, OXE program, phase F6, task FE-N2). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f6-design.md (U6.6).
// Contract (BACKEND #709, page shape from #706 ccr-f10-c5-backend.md §BE-A46-c5, from #658): window.oxe.paneConversation
// .{ has(paneId), page({ paneId, cursor? }), watch(paneId), unwatch(paneId), onChanged(cb({ paneId })) }. A page is
// { agent, title?, items: [{ seq, item: RemoteThreadItem }] (oldest first), cursor | null, epoch } or { error:
// 'no-conversation' | 'conversation-changed', reason? }. Dedupe by item.id; a new epoch is a new session; a newest page that
// shares no id with what is held is a gap. The renderer parts, in src/components/Panes/:
// - PaneConversationSwitch({ paneId }) (the header's two icons, only when has(paneId)); the choice lives in
//   usePaneConversationView (src/store/pane-conversation-view.store.ts), kept per pane while the pane is open;
// - PaneConversationView({ paneId, onShowScreen, onTypeInTerminal }) (the read-only reader).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Page = Record<string, unknown>
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
const msg = (seq: number, id: string, role: 'user' | 'assistant', text: string) => ({ seq, item: { type: 'message', id, role, text } })
const tool = (seq: number, id: string) => ({ seq, item: { type: 'tool', id, name: 'Bash', state: 'completed', detail: 'npm test' } })
const page = (o: Page = {}): Page => ({ agent: 'claude', items: [msg(1, 'native:a', 'user', 'Fix the test'), tool(2, 'native:t'), msg(3, 'native:b', 'assistant', 'Done, the test passes.')], cursor: 'c1', epoch: 1, ...o })

function mockMain(o: { has?: boolean; pages?: Page[] } = {}) {
  const pages = o.pages ?? [page()]
  let call = 0
  const listeners: Array<(event: { paneId: string }) => void> = []
  const api = {
    has: vi.fn(async () => o.has ?? true),
    page: vi.fn(async () => pages[Math.min(call++, pages.length - 1)]),
    watch: vi.fn(async () => undefined),
    unwatch: vi.fn(async () => undefined),
    onChanged: vi.fn((listener: (event: { paneId: string }) => void) => { listeners.push(listener); return () => undefined })
  }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, paneConversation: api } })
  return { api, changed: () => act(() => { for (const listener of listeners) listener({ paneId: 'p-1' }) }) }
}
type Panes = {
  PaneConversationSwitch: (props: { paneId: string }) => JSX.Element | null
  PaneConversationView: (props: { paneId: string; onShowScreen: () => void; onTypeInTerminal: () => void }) => JSX.Element
}
async function renderView() {
  const { PaneConversationView } = await load<Panes>('src/components/Panes/PaneConversationView')
  const onShowScreen = vi.fn(), onTypeInTerminal = vi.fn()
  render(<PaneConversationView paneId="p-1" onShowScreen={onShowScreen} onTypeInTerminal={onTypeInTerminal} />)
  return { onShowScreen, onTypeInTerminal }
}

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe("U6.6 · a terminal agent's conversation on the desktop", () => {
  test('the switch shows only for a pane main has a conversation for, with Terminal as the default', async () => {
    const main = mockMain({ has: true })
    const { PaneConversationSwitch } = await load<Panes>('src/components/Panes/PaneConversationSwitch')
    render(<PaneConversationSwitch paneId="p-1" />)
    const terminal = await screen.findByRole('button', { name: 'Terminal' })
    expect(terminal).toHaveAttribute('aria-pressed', 'true')
    expect(main.api.has).toHaveBeenCalledWith('p-1')
    await userEvent.click(screen.getByRole('button', { name: 'Conversation' }))
    expect(screen.getByRole('button', { name: 'Conversation' })).toHaveAttribute('aria-pressed', 'true')
    cleanup()
    mockMain({ has: false })
    const { container } = render(<PaneConversationSwitch paneId="p-9" />)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(screen.queryByRole('button', { name: 'Conversation' })).toBeNull()
    expect(container.textContent).toBe('')
  })

  test('the reader shows only the text bubbles, Read only and Live, Load earlier, and Type in the terminal', async () => {
    const main = mockMain()
    const { onTypeInTerminal } = await renderView()
    expect(await screen.findByText('Fix the test')).toBeInTheDocument()
    expect(screen.getByText('Done, the test passes.')).toBeInTheDocument()
    expect(screen.queryByText('npm test')).toBeNull()
    expect(screen.getByText('Read only')).toBeInTheDocument()
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(main.api.watch).toHaveBeenCalledWith('p-1')
    expect(screen.getByRole('button', { name: 'Load earlier' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Type in the terminal' }))
    expect(onTypeInTerminal).toHaveBeenCalled()
  })

  test('Load earlier asks for the next cursor and keeps each item once; the oldest page hides it', async () => {
    const main = mockMain({ pages: [page(), page({ items: [msg(1, 'native:0', 'user', 'Earlier question'), msg(2, 'native:a', 'user', 'Fix the test')], cursor: null })] })
    await renderView()
    await userEvent.click(await screen.findByRole('button', { name: 'Load earlier' }))
    expect(await screen.findByText('Earlier question')).toBeInTheDocument()
    expect(main.api.page).toHaveBeenLastCalledWith({ paneId: 'p-1', cursor: 'c1' })
    expect(screen.getAllByText('Fix the test')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Load earlier' })).toBeNull()
  })

  test('a new epoch replaces the items and marks a new conversation; a gap shows Latest with no count', async () => {
    const main = mockMain({ pages: [page(), page({ epoch: 2, items: [msg(1, 'native:z', 'user', 'A fresh start')] }), page({ epoch: 2, items: [msg(1, 'native:y', 'assistant', 'Far ahead')] })] })
    await renderView()
    await screen.findByText('Fix the test')
    main.changed()
    expect(await screen.findByText('The agent started a new conversation')).toBeInTheDocument()
    expect(screen.getByText('A fresh start')).toBeInTheDocument()
    expect(screen.queryByText('Fix the test')).toBeNull()
    main.changed()
    expect(await screen.findByText('Far ahead')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/new · Latest/)).toBeNull())
  })

  test('an unavailable conversation shows the Notice with Show the screen, after one reload on a rewrite', async () => {
    const main = mockMain({ pages: [{ error: 'conversation-changed', reason: 'rewritten' }, { error: 'no-conversation' }] })
    const { onShowScreen } = await renderView()
    expect(await screen.findByText("This terminal's conversation isn't available any more. The screen is still live.")).toBeInTheDocument()
    expect(main.api.page).toHaveBeenCalledTimes(2)
    await userEvent.click(screen.getByRole('button', { name: 'Show the screen' }))
    expect(onShowScreen).toHaveBeenCalled()
  })

  test('the reader reads in pt-BR, the same words as the phone', async () => {
    await changeLanguage('pt-BR')
    mockMain()
    await renderView()
    expect(await screen.findByText('Somente leitura')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Carregar anteriores' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Digite no terminal' })).toBeInTheDocument()
  })

  test('the choice is kept per pane: A on Conversation, B still on Terminal, and A again on Conversation after switching away and back', async () => {
    mockMain({ has: true })
    const { PaneConversationSwitch } = await load<Panes>('src/components/Panes/PaneConversationSwitch')
    const a = render(<PaneConversationSwitch paneId="p-a" />)
    await userEvent.click(await within(a.container).findByRole('button', { name: 'Conversation' }))
    const b = render(<PaneConversationSwitch paneId="p-b" />)
    expect(await within(b.container).findByRole('button', { name: 'Terminal' })).toHaveAttribute('aria-pressed', 'true')
    a.unmount()
    const again = render(<PaneConversationSwitch paneId="p-a" />)
    expect(await within(again.container).findByRole('button', { name: 'Conversation' })).toHaveAttribute('aria-pressed', 'true')
  })

})
