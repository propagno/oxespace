// LOGIN A (user 22/11, OXE-388): the failure card is a failed sign-in's one owner. Rendered in the conversation, in
// the account states a person meets: no strip, one Reconnect on the current failure, Try again only when connected
// again, one alert for the current failure only. A legacy failure without a code keeps the strip.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAccountStore } from '../src/store/account.store'
import { useThreadStore } from '../src/store/thread.store'
import { useWorkspaceStore } from '../src/store/workspace.store'
import { ThreadView } from '../src/components/Threads/ThreadView'
import { changeLanguage, i18n } from '../src/i18n'
import type { Workspace } from '../shared/types/workspace'

vi.mock('../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'feat/thread', detached: false, shortSha: null, error: null }) }))

const tt = (key: string): string => i18n.t(key, { ns: 'thread' }) as string
const ACCOUNTS = [['signed-out', 'subscription'], ['expired', 'subscription'], ['connected', 'subscription']] as const
const SIGNED_OUT = ACCOUNTS.slice(0, 2)
type History = 'one' | 'two' | 'then-success' | 'running-again' | 'legacy'

const message = (id: string, role: 'user' | 'assistant', text: string) => ({ type: 'message', id, role, text })
const authFailure = (id: string) => ({ type: 'completed', status: 'failed', errorCode: 'authentication', failure: { id, code: 'authentication', occurredAt: 1_790_000_000_000, message: 'Your agent account needs to be reconnected.' } })

async function conversation(state: string, method: string, history: History = 'one') {
  const first = history === 'two' || history === 'then-success' || history === 'running-again' ? [authFailure('f0')] : [message('a0', 'assistant', 'Done.'), { type: 'completed', status: 'completed' }]
  const last = history === 'then-success' ? [message('a1', 'assistant', 'Fixed.'), { type: 'completed', status: 'completed' }]
    : history === 'running-again' ? []
    : history === 'legacy' ? [message('a1', 'assistant', 'Failed to authenticate: OAuth session expired and could not be refreshed'), { type: 'completed', status: 'failed' }]
    : [authFailure('f1')]
  const events = [message('u0', 'user', 'An earlier prompt'), ...first, message('u1', 'user', 'Fix the login'), ...last]
  const turns = [{ id: 'u0', sequence: 1, status: history === 'two' || history === 'then-success' || history === 'running-again' ? 'failed' : 'completed', configuration: {} },
    { id: 'u1', sequence: 2, status: history === 'then-success' ? 'completed' : history === 'running-again' ? 'running' : 'failed', configuration: {} }]
  const thread = { id: 'thread', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Auth', pinned: false,
    status: history === 'then-success' ? 'idle' : history === 'running-again' ? 'running' : 'failed', nativeSessionId: 'native-1', createdAt: 1, updatedAt: 1, access: 'workspace-write', mode: 'default' }
  const snapshot = { thread, events, turns }
  const api = {
    commands: vi.fn(async () => ({ commands: [] })), projects: vi.fn(async () => ({ projects: [], unavailable: [] })), list: vi.fn(async () => [thread]),
    read: vi.fn(async () => snapshot), models: vi.fn(async () => ({ defaultModel: 'native-model', models: [] })), configure: vi.fn(async () => snapshot),
    send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), respond: vi.fn(async () => {}), onChanged: vi.fn(() => () => {}),
    turnFiles: vi.fn(async () => []), places: vi.fn(async () => ({ places: [], capped: false, refused: 0 })), onPlacesChanged: vi.fn(() => () => {}), collisions: vi.fn(async () => [])
  }
  const account = { provider: 'claude', scopeId: 'test', state, method, checkedAt: 1 }
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api, agentAccount: { read: vi.fn(async () => account) } } })
  const workspace = { id: 'ws', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useThreadStore.setState({ threads: [thread], projects: [{ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }], snapshot, selectedId: 'thread', secondaryId: null, drafts: {}, attachments: {} } as never)
  const onAccounts = vi.fn()
  render(<ThreadView workspace={workspace} onAccounts={onAccounts} />)
  await waitFor(() => expect(useAccountStore.getState().snapshots.test).toMatchObject({ state, method }))
  return { api, onAccounts }
}

const cards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-ui="failure-card"]')]
const strips = (): NodeListOf<Element> => document.querySelectorAll('.thread-connection-notice')
const reconnects = (root: HTMLElement = document.body): HTMLElement[] => within(root).queryAllByRole('button', { name: tt('view.reconnect'), hidden: true })
/** Every retry, by each of its names, disabled ones too. */
const retries = (): HTMLElement[] => screen.queryAllByRole('button', { hidden: true })
  .filter(button => [tt('failure.retry'), tt('view.retry'), tt('nowLine.actions.retry')].includes((button.textContent ?? '').trim()))

beforeEach(() => { localStorage.clear() })
afterEach(async () => { cleanup(); await changeLanguage('en') })

describe.each(['en', 'pt-BR'] as const)('(%s) LOGIN A', locale => {
  beforeEach(async () => { await changeLanguage(locale) })

  test.each(ACCOUNTS)('%s: no strip and no Notice: the card owns the failure', async (state, method) => {
    await conversation(state, method)
    expect(cards()).toHaveLength(1)
    expect(cards()[0]).toHaveTextContent(tt('failure.reconnect'))
    expect(strips(), 'no strip').toHaveLength(0)
    expect(cards()[0].querySelectorAll('[data-intent]'), 'no Notice').toHaveLength(0)
  })

  test.each(ACCOUNTS)('%s: exactly one Reconnect, which opens the accounts', async (state, method) => {
    const f = await conversation(state, method)
    expect(reconnects(), 'one Reconnect').toHaveLength(1)
    expect(cards()[0].contains(reconnects()[0]), 'in the card').toBe(true)
    await userEvent.click(reconnects()[0])
    expect(f.onAccounts).toHaveBeenCalledOnce()
    expect(f.api.send).not.toHaveBeenCalled()
  })

  test.each(SIGNED_OUT)('%s: no retry, not even a disabled one', async (state, method) => {
    await conversation(state, method)
    expect(retries()).toEqual([])
  })

  test('connected again: one Try again, which resends the last prompt once', async () => {
    const f = await conversation('connected', 'subscription')
    expect(retries()).toHaveLength(1)
    expect(retries()[0]).toHaveTextContent(tt('failure.retry'))
    expect(cards()[0].contains(retries()[0]), 'in the card').toBe(true)
    await userEvent.click(retries()[0])
    await waitFor(() => expect(f.api.send).toHaveBeenCalledWith('thread', 'Fix the login', []))
    expect(f.api.send).toHaveBeenCalledOnce()
  })

  test.each(ACCOUNTS)('%s: one alert, and it is the current failure', async (state, method) => {
    await conversation(state, method)
    const alerts = document.querySelectorAll('[role="alert"]')
    expect(alerts, 'one alert').toHaveLength(1)
    expect(cards()[0].contains(alerts[0]), 'the card announces').toBe(true)
  })

  test.each(ACCOUNTS)('%s: two failures in history: only the current one has Reconnect', async (state, method) => {
    await conversation(state, method, 'two')
    expect(cards()).toHaveLength(2)
    expect(cards().map(card => reconnects(card).length)).toEqual([0, 1])
  })

  test.each(ACCOUNTS)('%s: two failures in history: only the current one announces', async (state, method) => {
    await conversation(state, method, 'two')
    const alerts = document.querySelectorAll('[role="alert"]')
    expect(alerts, 'one alert').toHaveLength(1)
    expect(cards()[1].contains(alerts[0]), 'the current card').toBe(true)
  })

  test('a failure followed by a success is history: no alert, no Reconnect, no retry', async () => {
    await conversation('connected', 'subscription', 'then-success')
    expect(cards()).toHaveLength(1)
    expect(cards()[0].querySelectorAll('[role="alert"]'), 'no alert').toHaveLength(0)
    expect(reconnects(), 'no Reconnect').toEqual([])
    expect(retries(), 'no retry').toEqual([])
  })

  test('a failure with a turn running again is history: no alert, no Reconnect, no retry', async () => {
    await conversation('connected', 'subscription', 'running-again')
    expect(cards()).toHaveLength(1)
    expect(cards()[0].querySelectorAll('[role="alert"]'), 'no alert').toHaveLength(0)
    expect(reconnects(), 'no Reconnect').toEqual([])
    expect(retries(), 'no retry').toEqual([])
  })

  test.each(ACCOUNTS)('%s: a legacy failure without a code keeps the strip', async (state, method) => {
    await conversation(state, method, 'legacy')
    expect(strips()).toHaveLength(1)
    expect(reconnects(strips()[0] as HTMLElement)).toHaveLength(1)
  })
})
