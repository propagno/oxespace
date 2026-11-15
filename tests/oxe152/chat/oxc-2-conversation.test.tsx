// Frozen acceptance test for 1.5.2 OxeChat F4 "UI" (OXE program oxespace-152-chat, phase F4, Jira OXE-167, OXC-2
// "Conversa: cabeçalho e coluna"). Written by the planner; the executor must not edit it. Source: the written target v2
// approved by the user on 15/11 (oxechat-final-target.md, OXC-2; canvas boards 1, 7, 9-14), the brand's split of 15/11
// (the composer is its own card, OXC-2b), the header at --bar-lg (brand 15/11), the user's rule "mesmo padrão, tudo tem
// que sair como foi projetado na interface" and the coordinator's binding: the card's task adds the data-ui its
// measures read and turns ITS OWN measures of brd-04.json/brd-05.json (PR #842) to enforced.
// Today (main 21704086d) the conversation has no data-ui at all: a .thread-heading header with a bare h1, the transcript
// and composer without a shared column, user messages and turn folds without a hook, request cards without one.
// Contract (pixels are the conformance scenes' job, marca/conformidade; this file pins structure, words and behaviour):
// - Header: one [data-ui=chat-header]; its title is [data-ui=chat-title], the level-1 heading with the conversation
//   title; the subline in the header names the agent (threadAgentName), the project and the branch.
// - Column: one [data-ui=chat-column] holds the transcript: each user message is a [data-ui=user-message] with the text
//   the person sent (never an agent answer); each finished turn has one [data-ui=turn-line] whose text begins with the
//   state word (thread:turnTiming.completed) and then the step count (thread:fold.steps / fold.stepsWithParts).
// - Requests: a pending approval is one [data-ui=request-card] inside the column, answered by the existing buttons
//   (approvalButtons, #823): Negar (thread:request.deny) before Permitir uma vez (thread:f7.card.allowOnce).
// - BRD-04/BRD-05 (PR #842): the card's measures are enforced and in enforced.lock.json (BRD-04.tabs.count is also
//   OXE-169's: the first to land enforces it, the lock keeps it). The composer's measures are OXE-172's (OXC-2b), the panel toggles' and the main area's raw-button count OXC-4's (the tool tabs row it removes holds raw
//   buttons), the new conversation's OXC-3's.
// Queries use data-ui, ARIA roles and the active catalog's strings.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccountStore } from '../../../src/store/account.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { ThreadView } from '../../../src/components/Threads/ThreadView'
import { changeLanguage, i18n } from '../../../src/i18n'
import { threadAgentName } from '../../../shared/threadProviders'
import type { Workspace } from '../../../shared/types/workspace'
import type { ThreadApi, ThreadEvent, ThreadSnapshot } from '../../../shared/types/thread'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'feat/thread', detached: false, shortSha: null, error: null }) }))

const ROOT = process.cwd()
const tt = (key: string, options: Record<string, unknown> = {}): string => i18n.t(key, { ns: 'thread', ...options }) as string
function notEnforced(ids: readonly string[]): string[] {
  const dir = join(ROOT, 'src/design/targets')
  const lock = (JSON.parse(readFileSync(join(dir, 'enforced.lock.json'), 'utf8')) as { enforced: string[] }).enforced
  const measures = new Map(['brd-02', 'brd-04', 'brd-05'].flatMap(name => (JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as { measures: Array<{ id: string; state: string }> }).measures).map(item => [item.id, item.state]))
  return ids.flatMap(id => [...(!measures.has(id) ? [`${id} is not in src/design/targets`] : measures.get(id) === 'enforced' ? [] : [`${id} is ${measures.get(id)}`]), ...(lock.includes(id) ? [] : [`${id} is not in enforced.lock.json`])])
}
const OXC2_MEASURES = ['BRD-04.chat-header.height', 'BRD-04.tabs.count', 'BRD-04.column.width', 'BRD-04.user-message.radius', 'BRD-04.user-message.font-size', 'BRD-04.turn-line.font-size',
  'BRD-04.request.radius', 'BRD-04.request.button.height', 'BRD-05.title.font-size', 'BRD-05.title.font-weight', 'BRD-05.title.font-family'] as const

const TURN: ThreadEvent[] = [
  { type: 'message', id: 'u1', role: 'user', text: 'Fix the login redirect' },
  { type: 'tool', id: 't1', name: 'Read', state: 'completed', detail: 'src/auth.ts' },
  { type: 'tool', id: 't2', name: 'Edit', state: 'completed', detail: 'src/auth.ts', files: [{ path: '/repo/src/auth.ts', kind: 'update', source: 'native-patch', state: 'completed', additions: 4, deletions: 1 }] },
  { type: 'message', id: 'a1', role: 'assistant', text: 'The redirect now keeps the original path.' },
  { type: 'completed', status: 'completed' }
] as ThreadEvent[]
const REQUEST: ThreadEvent = { type: 'request', id: 'req', request: { id: 'req', nativeId: 'native-req', nativeMethod: 'can_use_tool:Bash', kind: 'approval', title: 'Claude wants to run a command', command: 'npm test', toolName: 'Bash',
  state: 'pending', generation: 1, createdAt: 1, availableDecisions: ['accept', 'decline'] } } as ThreadEvent

function fixture(events: ThreadEvent[], status: 'idle' | 'approval' = 'idle') {
  const snapshot: ThreadSnapshot = { thread: { id: 'thread', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Auth investigation', pinned: false, status, nativeSessionId: 'native-1', createdAt: 1, updatedAt: 1, access: 'full-access' }, events }
  const api = { commands: vi.fn(async () => ({ commands: [] })), projects: vi.fn(async () => ({ projects: [], unavailable: [] })), list: vi.fn(async () => [snapshot.thread]), create: vi.fn(async () => snapshot), read: vi.fn(async () => snapshot),
    models: vi.fn(async () => ({ defaultModel: 'native-model', models: [{ id: 'native-model', label: 'Native model', description: '', efforts: ['low', 'high'], defaultEffort: 'low' }] })),
    configure: vi.fn(async () => snapshot), send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), respond: vi.fn(async () => {}), pin: vi.fn(async () => {}), onChanged: vi.fn(() => () => {}),
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

beforeEach(() => { localStorage.clear() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-167 OXC-2 conversation header and column (A11)', () => {
  it.each(['en', 'pt-BR'])('the header (%s) is one chat-header whose chat-title is the h1 and whose subline names agent, project and branch', async locale => {
    await changeLanguage(locale)
    const f = fixture(TURN)
    render(<ThreadView workspace={f.workspace} />)
    const header = one('[data-ui="chat-header"]')
    const title = one('[data-ui="chat-title"]', header)
    expect(title).toHaveTextContent('Auth investigation')
    expect(within(header).getByRole('heading', { level: 1 })).toBe(title)
    for (const word of [threadAgentName('claude'), 'Repo', 'feat/thread']) expect(header, `subline names ${word}`).toHaveTextContent(word)
  })

  it('one chat-column holds the transcript; each sent message is a user-message, never an answer', async () => {
    const f = fixture(TURN)
    render(<ThreadView workspace={f.workspace} />)
    const column = one('[data-ui="chat-column"]')
    const users = [...column.querySelectorAll<HTMLElement>('[data-ui="user-message"]')]
    expect(users.map(item => item.textContent?.trim())).toEqual([expect.stringContaining('Fix the login redirect')])
    expect(users[0].textContent).not.toContain('The redirect now keeps the original path.')
    expect(within(column).getByText('The redirect now keeps the original path.')).toBeInTheDocument()
    expect(column.contains(one('[data-ui="chat-header"]')), 'the header sits outside the column').toBe(false)
  })

  it.each(['en', 'pt-BR'])('a finished turn (%s) has one turn-line: the state word first, then the steps', async locale => {
    await changeLanguage(locale)
    const f = fixture(TURN)
    render(<ThreadView workspace={f.workspace} />)
    const line = one('[data-ui="turn-line"]', one('[data-ui="chat-column"]'))
    const text = line.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    expect(text.startsWith(tt('turnTiming.completed')), `"${text}" starts with ${tt('turnTiming.completed')}`).toBe(true)
    expect([1, 2, 3].some(count => text.includes(tt('fold.steps', { count }))), `"${text}" counts the steps`).toBe(true)
  })

  it('a pending approval is one request-card in the column, answered by the existing buttons: Negar before Permitir uma vez', async () => {
    const f = fixture([{ type: 'message', id: 'u1', role: 'user', text: 'Run the tests' } as ThreadEvent, REQUEST], 'approval')
    render(<ThreadView workspace={f.workspace} />)
    const card = one('[data-ui="request-card"]', one('[data-ui="chat-column"]'))
    expect(card).toHaveTextContent('npm test')
    const names = within(card).getAllByRole('button').map(button => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim())
    const deny = names.findIndex(name => name.startsWith(tt('request.deny'))), allow = names.findIndex(name => name.startsWith(tt('f7.card.allowOnce')))
    expect([deny >= 0, allow >= 0, deny < allow], `buttons ${names.join(' | ')}`).toEqual([true, true, true])
  })

  it('turns its own BRD-04 and BRD-05 measures to enforced', () => {
    expect(notEnforced(OXC2_MEASURES)).toEqual([])
  })
})
