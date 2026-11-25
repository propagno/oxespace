import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewConversationScreen } from '../../../src/components/Threads/NewConversationScreen'
import { attachOpenThreadDraftListener } from '../../../src/components/Terminal/threadDraftBridge'
import { useThreadStore } from '../../../src/store/thread.store'
import { changeLanguage, i18n } from '../../../src/i18n'
import type { ConversationThread, ThreadApi, ThreadProjectSummary } from '../../../shared/types/thread'
import type { ThreadActiveWriter } from '../../../shared/types/thread-places'

const tt = (key: string, options: Record<string, unknown> = {}): string => i18n.t(key, { ns: 'thread', ...options }) as string

const PROJECT: ThreadProjectSummary = {
  projectId: 'p1',
  displayName: 'Atlas',
  identityLabel: '/repos/atlas',
  hidden: false,
  contexts: [{ rootPath: '/repos/atlas', label: 'atlas' }]
}

const WORKTREE = '/repos/atlas-worktrees/fix-login'

function makeThread(id: string, title: string, extra: Partial<ConversationThread> = {}): ConversationThread {
  return {
    id,
    workspaceId: 'thread:p1',
    projectId: 'p1',
    rootPath: '/repos/atlas',
    provider: 'claude',
    nativeSessionId: null,
    title,
    pinned: false,
    status: 'idle',
    access: 'full-access',
    createdAt: 100,
    updatedAt: 100,
    ...extra
  }
}

let api: Record<string, ReturnType<typeof vi.fn>>

function setupFixture(options: { threads?: ConversationThread[]; writers?: ThreadActiveWriter[]; access?: 'read-only' | 'workspace-write' | 'full-access' } = {}): void {
  const threads = options.threads ?? []
  const created = { thread: makeThread('t-new', '', { access: options.access ?? 'full-access' }), events: [] }
  const createdChild = { thread: makeThread('t-child', '', { parentThreadId: 'parent-1', rootPath: WORKTREE, access: options.access ?? 'full-access' }), events: [] }
  api = {
    create: vi.fn(async () => created),
    createChat: vi.fn(async () => createdChild),
    send: vi.fn(async () => {}),
    read: vi.fn(async () => created),
    list: vi.fn(async () => threads),
    projects: vi.fn(async () => ({ projects: [PROJECT], unavailable: [] })),
    newConversationAccess: vi.fn(async () => options.access ?? 'full-access'),
    activeWriters: vi.fn(async () => options.writers ?? []),
    onChanged: vi.fn(() => () => {})
  }
  Object.defineProperty(window, 'oxe', {
    configurable: true,
    value: {
      thread: api as unknown as ThreadApi,
      agent: { getReadiness: vi.fn(async () => [{ provider: 'claude', status: 'ready' }, { provider: 'codex', status: 'ready' }]) }
    }
  })
  useThreadStore.setState({
    threads,
    projects: [PROJECT],
    unavailableProjects: [],
    loading: false,
    listLoaded: true,
    selectedId: null,
    secondaryId: null,
    snapshot: null,
    drafts: {}
  } as never)
}

beforeEach(() => { localStorage.clear() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-189 AG-07 preventive collision warning', () => {
  it.each([
    ['en', 'Another agent is editing this folder (Fix login bug).', 'Create isolated worktree', 'Continue here'],
    ['pt-BR', 'Outro agente está editando esta pasta (Fix login bug).', 'Criar worktree isolada', 'Continuar aqui']
  ] as const)('CA-1: shows a 1-line warning Notice above the composer with Button controls (%s) and never downgrades access', async (locale, expectedText, worktreeBtn, continueBtn) => {
    await changeLanguage(locale)
    setupFixture({
      writers: [{ id: 't-active', title: 'Fix login bug', kind: 'thread' }],
      access: 'full-access'
    })

    render(<NewConversationScreen projectId="p1" />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-intent', 'warning')
    expect(alert).toHaveTextContent(expectedText)

    // Sits above the composer.
    const composer = document.querySelector('[data-ui="composer"]')!
    expect(alert.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // Uses src/ui Button controls (size sm) inside the notice.
    const buttons = within(alert).getAllByRole('button')
    expect(buttons.map(btn => btn.textContent?.trim())).toEqual([worktreeBtn, continueBtn])
    for (const btn of buttons) expect(btn).toHaveAttribute('data-ui', 'button')

    // Access level remains full-access (never downgraded).
    const contextGroup = screen.getByRole('group', { name: tt('opening.context') })
    await waitFor(() => expect(contextGroup).toHaveTextContent(tt('opening.access.full-access')))
    expect(contextGroup.querySelector('[data-access]')).toHaveAttribute('data-access', 'full-access')
  })

  it('CA-2: clicking "Create isolated worktree" turns on inWorktree, hides warning, and creates in a worktree without downgrading access', async () => {
    setupFixture({
      writers: [{ id: 'pane-1', title: 'Claude Code', kind: 'pane' }],
      access: 'full-access'
    })

    render(<NewConversationScreen projectId="p1" />)

    const alert = await screen.findByRole('alert')
    const worktreeSwitch = screen.getByRole('switch', { name: tt('dialogs.inWorktree') })
    expect(worktreeSwitch).not.toBeChecked()

    fireEvent.click(within(alert).getByRole('button', { name: 'Create isolated worktree' }))

    expect(worktreeSwitch).toBeChecked()
    expect(screen.queryByRole('alert')).toBeNull()
    await waitFor(() => expect(screen.getByRole('group', { name: tt('opening.context') })).toHaveTextContent(tt('opening.access.full-access')))

    const box = screen.getByRole('textbox', { name: tt('composer.message') })
    fireEvent.change(box, { target: { value: 'Add validation' } })
    await waitFor(() => expect(screen.getByRole('button', { name: tt('composer.send') })).toBeEnabled(), { timeout: 10_000 })
    fireEvent.keyDown(box, { key: 'Enter' })

    await waitFor(() => expect(api.create).toHaveBeenCalledWith({
      projectId: 'p1',
      rootPath: '/repos/atlas',
      provider: 'claude',
      worktree: {}
    }))
  })

  it('CA-3: clicking "Continue here" dismisses the warning without changing any field or downgrading access', async () => {
    setupFixture({
      writers: [{ id: 't-active', title: 'Fix login bug', kind: 'thread' }],
      access: 'full-access'
    })

    render(<NewConversationScreen projectId="p1" />)

    const alert = await screen.findByRole('alert')
    const box = screen.getByRole('textbox', { name: tt('composer.message') }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'Keep my draft' } })

    fireEvent.click(within(alert).getByRole('button', { name: 'Continue here' }))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('switch', { name: tt('dialogs.inWorktree') })).not.toBeChecked()
    expect(box.value).toBe('Keep my draft')
    await waitFor(() => expect(screen.getByRole('group', { name: tt('opening.context') })).toHaveTextContent(tt('opening.access.full-access')))
    await waitFor(() => expect(screen.getByRole('button', { name: tt('composer.send') })).toBeEnabled(), { timeout: 10_000 })

    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({
      projectId: 'p1',
      rootPath: '/repos/atlas',
      provider: 'claude'
    }))
  })

  it.each([
    ['en', 'The other conversation in this session is editing these files now.', 'Open as a new isolated conversation', 'Continue here'],
    ['pt-BR', 'A outra conversa desta sessão está editando estes arquivos agora.', 'Abrir como nova conversa isolada', 'Continuar aqui']
  ] as const)('CA-4: parallel screen warns when parent session is editing (%s) and exits to normal isolated screen preserving project, agent and draft', async (locale, expectedText, openIsolatedBtn, continueBtn) => {
    await changeLanguage(locale)
    const parent = makeThread('parent-1', 'Fix the login bug', {
      status: 'running',
      access: 'full-access',
      rootPath: WORKTREE,
      ownedWorktree: { path: WORKTREE, branch: 'fix/login', projectRoot: '/repos/atlas', baseSha: '0'.repeat(40), createdAt: 1 }
    })
    setupFixture({
      threads: [parent],
      writers: [{ id: 'parent-1', title: 'Fix the login bug', kind: 'thread' }],
      access: 'full-access'
    })

    const openedDrafts: Array<{ projectId: string | null; rootPath?: string }> = []
    const detach = attachOpenThreadDraftListener({
      selectThreadMode: () => {},
      openNewThread: (pid, root) => openedDrafts.push({ projectId: pid, rootPath: root })
    })

    try {
      render(<NewConversationScreen projectId="p1" parentThreadId="parent-1" />)

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveAttribute('data-intent', 'warning')
      expect(alert).toHaveTextContent(expectedText)

      const buttons = within(alert).getAllByRole('button')
      expect(buttons.map(btn => btn.textContent?.trim())).toEqual([openIsolatedBtn, continueBtn])

      // Pick Codex and type a draft before exiting parallel mode.
      const user = userEvent.setup()
      const contextGroup = screen.getByRole('group', { name: tt('opening.context') })
      const pickers = [...contextGroup.querySelectorAll<HTMLElement>('[data-ui="context-picker"]')]
      await user.click(pickers[1])
      await user.click(await screen.findByRole('menuitem', { name: 'Codex' }))

      const box = screen.getByRole('textbox', { name: tt('composer.message') }) as HTMLTextAreaElement
      fireEvent.change(box, { target: { value: 'Try isolated branch' } })

      // Click primary action: exit parallel screen to normal OXE-168 screen with inWorktree ON, same agent & draft.
      fireEvent.click(within(alert).getByRole('button', { name: openIsolatedBtn }))

      // Bridge notified App shell to switch off parentThreadId, and screen switched in-place to normal OXE-168 mode.
      expect(openedDrafts).toEqual([{ projectId: 'p1', rootPath: '/repos/atlas' }])
      expect(screen.queryByText(tt('parallel.notice'))).toBeNull()
      const worktreeSwitch = screen.getByRole('switch', { name: tt('dialogs.inWorktree') })
      expect(worktreeSwitch).toBeChecked()
      expect(box.value).toBe('Try isolated branch')
      await waitFor(() => expect(screen.getByRole('group', { name: tt('opening.context') })).toHaveTextContent(tt('opening.access.full-access')))

      // Sending now calls api.create with worktree (NOT createChat — NOT a child!).
      await waitFor(() => expect(screen.getByRole('button', { name: tt('composer.send') })).toBeEnabled(), { timeout: 10_000 })
      fireEvent.keyDown(box, { key: 'Enter' })
      await waitFor(() => expect(api.create).toHaveBeenCalledWith({
        projectId: 'p1',
        rootPath: '/repos/atlas',
        provider: 'codex',
        worktree: {}
      }))
      expect(api.createChat).not.toHaveBeenCalled()
    } finally {
      detach()
    }
  })

  it('CA-4: clicking "Continue here" in parallel screen stays in shared folder without downgrading access', async () => {
    const parent = makeThread('parent-1', 'Fix the login bug', {
      status: 'running',
      access: 'full-access',
      rootPath: WORKTREE,
      ownedWorktree: { path: WORKTREE, branch: 'fix/login', projectRoot: '/repos/atlas', baseSha: '0'.repeat(40), createdAt: 1 }
    })
    setupFixture({
      threads: [parent],
      writers: [{ id: 'parent-1', title: 'Fix the login bug', kind: 'thread' }],
      access: 'full-access'
    })

    render(<NewConversationScreen projectId="p1" parentThreadId="parent-1" />)

    const alert = await screen.findByRole('alert')
    fireEvent.click(within(alert).getByRole('button', { name: 'Continue here' }))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText(tt('parallel.notice'))).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('group', { name: tt('opening.context') })).toHaveTextContent(tt('opening.access.full-access')))

    const box = screen.getByRole('textbox', { name: tt('composer.message') })
    fireEvent.change(box, { target: { value: 'Work together in same folder' } })
    await waitFor(() => expect(screen.getByRole('button', { name: tt('composer.send') })).toBeEnabled(), { timeout: 10_000 })
    fireEvent.keyDown(box, { key: 'Enter' })

    await waitFor(() => expect(api.createChat).toHaveBeenCalledWith('parent-1', { provider: 'claude' }))
    expect(api.create).not.toHaveBeenCalled()
  })
})
