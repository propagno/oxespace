// ÓRFÃOS F5 A (user 22/11, OXE-388; 8e: lost function): with NowLine out of the quiet header, a conversation's pull
// request still opens, whatever its state, from the existing More actions menu, through the same openExternalLink call.
// The item exists only when the conversation's pull request has a URL; the header itself gains nothing.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useAccountStore } from '../src/store/account.store'
import { useThreadStore } from '../src/store/thread.store'
import { useWorkspaceStore } from '../src/store/workspace.store'
import { ThreadView } from '../src/components/Threads/ThreadView'
import { openExternalLink } from '../src/lib/externalLinks'
import { changeLanguage, i18n } from '../src/i18n'
import type { Workspace } from '../shared/types/workspace'

vi.mock('../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'feat/thread', detached: false, shortSha: null, error: null }) }))
vi.mock('../src/lib/externalLinks', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/externalLinks')>(), openExternalLink: vi.fn(async () => true) }))

const tt = (key: string): string => i18n.t(key, { ns: 'thread' }) as string
const PR_URL = 'https://github.com/acme/repo/pull/7'

/** The conversation with this pull request, and its More actions menu open. */
async function menuWith(status: Record<string, unknown> | null): Promise<HTMLElement> {
  const thread = { id: 'thread', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Fix', pinned: false, status: 'idle', nativeSessionId: 'native-1', createdAt: 1, updatedAt: 1, access: 'workspace-write', mode: 'default' }
  const snapshot = { thread, events: [{ type: 'message', id: 'u0', role: 'user', text: 'Fix it' }, { type: 'completed', status: 'completed' }] }
  const api = {
    commands: vi.fn(async () => ({ commands: [] })), projects: vi.fn(async () => ({ projects: [], unavailable: [] })), list: vi.fn(async () => [thread]),
    read: vi.fn(async () => snapshot), models: vi.fn(async () => ({ defaultModel: 'native-model', models: [] })), onChanged: vi.fn(() => () => {}),
    turnFiles: vi.fn(async () => []), places: vi.fn(async () => ({ places: [], capped: false, refused: 0 })), onPlacesChanged: vi.fn(() => () => {}), collisions: vi.fn(async () => [])
  }
  const getPullRequestStatus = vi.fn(async () => status)
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api, github: { getPullRequestStatus }, agentAccount: { read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 })) } } })
  const workspace = { id: 'ws', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useThreadStore.setState({ threads: [thread], projects: [{ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }], snapshot, selectedId: 'thread', secondaryId: null, drafts: {}, attachments: {} } as never)
  render(<ThreadView workspace={workspace} />)
  await waitFor(() => expect(getPullRequestStatus).toHaveBeenCalled())
  await new Promise(resolve => setTimeout(resolve, 0))
  fireEvent.keyDown(screen.getByRole('button', { name: tt('header.moreActions') }), { key: 'Enter' })
  const menu = await screen.findByRole('menu', { name: tt('header.moreActions') })
  expect(within(menu).getByRole('menuitem', { name: tt('moreActions.rename') }), 'the menu is the real one').toBeInTheDocument()
  return menu
}
const pr = (state: string, url: string | null = PR_URL) => ({ number: 7, title: 'Fix', url, state, isDraft: false, checks: [] })

beforeEach(() => { localStorage.clear(); vi.mocked(openExternalLink).mockClear() })
afterEach(async () => { cleanup(); await changeLanguage('en') })

describe.each(['en', 'pt-BR'] as const)('(%s) Open pull request in More actions', locale => {
  beforeEach(async () => { await changeLanguage(locale) })

  test.each(['MERGED', 'CLOSED', 'OPEN'])('a %s pull request opens from the menu', async state => {
    const menu = await menuWith(pr(state))
    fireEvent.click(within(menu).getByRole('menuitem', { name: tt('nowLine.actions.openPr') }))
    await waitFor(() => expect(openExternalLink).toHaveBeenCalledWith(PR_URL, { source: 'github' }))
    expect(openExternalLink).toHaveBeenCalledOnce()
  })

  test.each([['no pull request', null], ['a pull request without a URL', pr('MERGED', null)]] as const)('%s: no such item', async (_name, status) => {
    const menu = await menuWith(status)
    expect(within(menu).queryByRole('menuitem', { name: tt('nowLine.actions.openPr') })).toBeNull()
  })
})
