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
// - BRD-19 folded into OXE-167 (coordination 15/11; canvas v2 board 7): ThreadFailureCard has one mould: the title
//   (thread:failure.title.*), then the message, then the action buttons; a usage failure reads Tentar o turno de novo
//   (thread:failure.retry) before Atualizar o uso (thread:failure.refresh); the provider's codes and raw detail sit only
//   under the "Detalhes técnicos" / "Technical details" disclosure (POLISH-06 #1, PDM-approved 15/11: it was
//   "Diagnóstico do provedor"; thread:failure.diagnostic carries the new text), hidden until opened; usage limits stay
//   compact: one line per window, "<window> · N% usados · Renova em …" (failure.window.* · failure.used · failure.resetsIn),
//   no progress bars. Each kind keeps its existing action in that mould: context -> Compactar a conversa (failure.compact),
//   configuration -> Mudar a configuração (failure.changeConfiguration), sandbox -> Revisar as permissões
//   (failure.reviewPermissions), a turn that changed files -> Desfazer as alterações e tentar de novo / Tentar de novo sem
//   desfazer (failure.undoAndRetry / retryKeep), authentication -> the reconnect sentence (failure.reconnect), no retry.
// - BRD-21 folded into OXE-167 (superseded by v2): Mais ações holds today's items in four groups, destructive last:
//   Renomear · Fixar · Delegar… · Servidores MCP… | Texto maior · Mostrar cada chamada de ferramenta · Detalhes |
//   Abrir no OxeCode · Bifurcar · Exportar | Arquivar · Excluir… (thread:moreActions.*); Bifurcar is disabled for a
//   non-Codex conversation with its reason (thread:moreActions.forkCodexOnly). Brand 15/11 (PDM-approved): "Abrir no
//   OxeCode" comes FIRST in group 3 ("Abrir no OxeCode" / "Open in OxeCode"); with an owned worktree it reads "Abrir a
//   worktree no OxeCode" / "Open the worktree in OxeCode"; it calls ThreadHeader's onOpenInCode(path), the same handler the
//   project menu and ThreadWorktreeFinishDialog use, with the worktree's path or else the conversation's rootPath.
// - BRD-04/BRD-05 (PR #842): the card's measures are enforced and in enforced.lock.json (BRD-04.tabs.count is also
//   OXE-169's: the first to land enforces it, the lock keeps it). The composer's measures are OXE-172's (OXC-2b), the panel toggles' and the main area's raw-button count OXC-4's (the tool tabs row it removes holds raw
//   buttons), the new conversation's OXC-3's.
// Queries use data-ui, ARIA roles and the active catalog's strings.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccountStore } from '../../../src/store/account.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { ThreadView } from '../../../src/components/Threads/ThreadView'
import { ThreadHeader } from '../../../src/components/Threads/ThreadHeader'
import { ThreadFailureCard, usageResetIn, usageWindowLabel } from '../../../src/components/Threads/ThreadFailureCard'
import { changeLanguage, i18n } from '../../../src/i18n'
import { threadAgentName } from '../../../shared/threadProviders'
import type { Workspace } from '../../../shared/types/workspace'
import type { ConversationThread, ThreadApi, ThreadEvent, ThreadFailure, ThreadSnapshot } from '../../../shared/types/thread'

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

const RESETS_AT = Date.now() + 2 * 3600_000
/** POLISH-06 #1 (PDM-approved 15/11): the disclosure that holds the provider's codes. */
const TECHNICAL_DETAILS = { en: 'Technical details', 'pt-BR': 'Detalhes técnicos' } as const
const failed = (failure: Partial<ThreadFailure> & Pick<ThreadFailure, 'code'>): Extract<ThreadEvent, { type: 'completed' }> => ({
  type: 'completed', status: 'failed', failure: { id: `f-${failure.code}`, occurredAt: 1_790_000_000_000, message: 'The provider stopped the turn.', ...failure } as ThreadFailure })
const buttonNames = (root: HTMLElement): string[] => within(root).queryAllByRole('button').map(button => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim())

describe('OXE-167 OXC-2 failure card mould, BRD-19 (A11)', () => {
  it.each(['en', 'pt-BR'] as const)('a usage failure (%s): title, message, Tentar before Atualizar, codes only under Detalhes técnicos, one compact line per window', async locale => {
    await changeLanguage(locale)
    const { container } = render(<ThreadFailureCard latest onRetry={vi.fn()} refreshUsage={vi.fn(async () => ({ windows: [], checkedAt: 1 }))}
      event={failed({ code: 'usage', providerCode: 'usage_limit_reached', httpStatus: 429, detail: 'raw provider body 7f3a', usage: { checkedAt: 1_790_000_000_000, windows: [{ label: 'Session · 5 hours', usedPercent: 100, resetsAt: RESETS_AT }] } })} />)
    const title = screen.getByText(tt('failure.title.usage'))
    const buttons = buttonNames(container as HTMLElement)
    const retry = buttons.indexOf(tt('failure.retry')), refresh = buttons.indexOf(tt('failure.refresh'))
    expect([retry >= 0, refresh >= 0, retry < refresh], `buttons ${buttons.join(' | ')}`).toEqual([true, true, true])
    for (const code of ['usage_limit_reached', 'HTTP 429', 'raw provider body 7f3a']) expect(screen.getByText(code, { exact: false }), `${code} waits under the diagnostic`).not.toBeVisible()
    const disclosure = screen.getByText(TECHNICAL_DETAILS[locale])
    expect(Boolean(title.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING), 'the diagnostic comes after the title').toBe(true)
    fireEvent.click(disclosure)
    for (const code of ['usage_limit_reached', 'raw provider body 7f3a']) expect(screen.getByText(code, { exact: false }), `${code} shows once opened`).toBeVisible()
    const line = `${usageWindowLabel('Session · 5 hours')} · ${tt('failure.used', { percent: '100' })} · ${tt('failure.resetsIn', { time: usageResetIn(RESETS_AT) })}`
    expect([...container.querySelectorAll('*')].some(element => element.textContent?.replace(/\s+/g, ' ').trim() === line), `one line "${line}"`).toBe(true)
    expect(container.querySelectorAll('progress'), 'usage limits stay compact').toHaveLength(0)
  })

  it.each([
    ['context', 'failure.compact', 'onCompact'],
    ['configuration', 'failure.changeConfiguration', 'onPermissions'],
    ['sandbox', 'failure.reviewPermissions', 'onPermissions']
  ] as const)('a %s failure keeps its action (%s) in the mould', (code, key, handler) => {
    const callbacks = { onCompact: vi.fn(), onPermissions: vi.fn(), onRetry: vi.fn() }
    render(<ThreadFailureCard latest event={failed({ code })} {...callbacks} />)
    expect(screen.getByText(tt(`failure.title.${code}`))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: tt(key) }))
    expect(callbacks[handler]).toHaveBeenCalled()
  })

  it('a turn that changed files offers Desfazer as alterações e tentar de novo or Tentar de novo sem desfazer', () => {
    const onRetry = vi.fn()
    render(<ThreadFailureCard latest hasChanges onRetry={onRetry} event={failed({ code: 'server' })} />)
    fireEvent.click(screen.getByRole('button', { name: tt('failure.retry') }))
    expect(screen.getByRole('button', { name: tt('failure.retryKeep') })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: tt('failure.undoAndRetry') }))
    expect(onRetry).toHaveBeenCalledWith(true)
  })

  it('an authentication failure says to reconnect and offers no retry', () => {
    const { container } = render(<ThreadFailureCard latest onRetry={vi.fn()} event={failed({ code: 'authentication' })} />)
    expect(screen.getByText(tt('failure.title.authentication'))).toBeInTheDocument()
    expect(container).toHaveTextContent(tt('failure.reconnect'))
    expect(buttonNames(container as HTMLElement)).not.toContain(tt('failure.retry'))
  })
})

const HEADER_THREAD = { id: 't1', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Fix login', pinned: false, status: 'idle', nativeSessionId: null, createdAt: 1, updatedAt: 1 } as ConversationThread
const OPEN_IN_CODE = { en: 'Open in OxeCode', 'pt-BR': 'Abrir no OxeCode' } as const
const OPEN_WORKTREE_IN_CODE = { en: 'Open the worktree in OxeCode', 'pt-BR': 'Abrir a worktree no OxeCode' } as const
/** ThreadHeader's props, with the onOpenInCode the conversation's menu uses (the App's handler in the app). */
const headerProps = (thread: ConversationThread, onOpenInCode: (path: string) => Promise<void>) => ({
  thread, pending: false, running: false, onCommand: () => {}, onDelegate: () => {}, onPin: () => {}, onExport: () => {}, onTogglePanel: () => {}, onOpenInCode
}) as unknown as Parameters<typeof ThreadHeader>[0]
async function openMenu(): Promise<HTMLElement> {
  fireEvent.keyDown(screen.getByRole('button', { name: tt('header.moreActions') }), { key: 'Enter' })
  return screen.findByRole('menu', { name: tt('header.moreActions') })
}

describe('OXE-167 OXC-2 Mais ações in four groups, BRD-21 (A11)', () => {
  it.each(['en', 'pt-BR'])('lists today\'s items (%s) in four groups, destructive last, Bifurcar disabled with its reason', async locale => {
    await changeLanguage(locale)
    render(<ThreadHeader {...headerProps(HEADER_THREAD, vi.fn(async () => undefined))} />)
    fireEvent.keyDown(screen.getByRole('button', { name: tt('header.moreActions') }), { key: 'Enter' })
    const menu = await screen.findByRole('menu', { name: tt('header.moreActions') })
    const groups: string[][] = [[]]
    for (const element of menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"], [role="separator"]')) {
      if (element.getAttribute('role') === 'separator') { if (groups.at(-1)!.length) groups.push([]) } else groups.at(-1)!.push(element.textContent?.trim() ?? '')
    }
    const expected = [['rename', 'pin', 'delegate', 'mcp'], ['largerText', 'showEveryToolCall', 'details'], ['openInCode', 'fork', 'export'], ['archive', 'delete']]
    const label = (key: string): string => key === 'openInCode' ? OPEN_IN_CODE[locale as 'en'] : tt(`moreActions.${key}`)
    expect(groups.map(group => group.length), `groups ${JSON.stringify(groups)}`).toEqual(expected.map(group => group.length))
    expected.forEach((group, index) => group.forEach((key, position) =>
      expect(groups[index][position].startsWith(label(key)), `group ${index + 1}, item ${position + 1}: "${groups[index][position]}" is ${label(key)}`).toBe(true)))
    const fork = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.trim().startsWith(tt('moreActions.fork')))!
    expect(fork).toHaveAttribute('aria-disabled', 'true')
    expect(fork.textContent).toContain(tt('moreActions.forkCodexOnly'))
  })
})

describe('OXE-167 OXC-2 Abrir no OxeCode in Mais ações, brand 15/11 (A11)', () => {
  it.each(['en', 'pt-BR'] as const)('without a worktree (%s) it reads Abrir no OxeCode and opens the conversation\'s folder', async locale => {
    await changeLanguage(locale)
    const onOpenInCode = vi.fn(async () => undefined)
    render(<ThreadHeader {...headerProps(HEADER_THREAD, onOpenInCode)} />)
    const menu = await openMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: OPEN_IN_CODE[locale] }))
    expect(onOpenInCode).toHaveBeenCalledWith('/repo')
  })

  it.each(['en', 'pt-BR'] as const)('with an owned worktree (%s) it reads Abrir a worktree no OxeCode and opens the worktree', async locale => {
    await changeLanguage(locale)
    const onOpenInCode = vi.fn(async () => undefined)
    const thread = { ...HEADER_THREAD, rootPath: '/repo-worktrees/fix-login', ownedWorktree: { path: '/repo-worktrees/fix-login', branch: 'fix/login', projectRoot: '/repo', baseSha: '0'.repeat(40), createdAt: 1 } } as ConversationThread
    render(<ThreadHeader {...headerProps(thread, onOpenInCode)} />)
    const menu = await openMenu()
    expect(within(menu).queryByRole('menuitem', { name: OPEN_IN_CODE[locale] }), 'one label, the worktree one').toBeNull()
    fireEvent.click(within(menu).getByRole('menuitem', { name: OPEN_WORKTREE_IN_CODE[locale] }))
    expect(onOpenInCode).toHaveBeenCalledWith('/repo-worktrees/fix-login')
  })

  it('adds the worktree label pair to the catalogs', () => {
    const flat = (value: unknown, prefix = ''): Record<string, string> => Object.assign({}, ...Object.entries(value as Record<string, unknown>).map(([key, item]) =>
      typeof item === 'string' ? { [prefix + key]: item } : flat(item, `${prefix}${key}.`)))
    const en = flat(JSON.parse(readFileSync(join(ROOT, 'shared/locales/en/thread.json'), 'utf8')))
    const pt = flat(JSON.parse(readFileSync(join(ROOT, 'shared/locales/pt-BR/thread.json'), 'utf8')))
    expect(Object.keys(en).some(key => en[key] === OPEN_WORKTREE_IN_CODE.en && pt[key] === OPEN_WORKTREE_IN_CODE['pt-BR']), 'one key holds both texts').toBe(true)
  })
})
