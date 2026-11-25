// Frozen acceptance test for 1.5.2 OxeChat F5, CR-a (OXE-168 OXC-3; A17, A21 and AG-08's OXE-190 on the new screen).
// Written by the planner; the executor must not edit it. It narrows nothing of A17, A21 or A22.
// Contract:
// - NewConversationScreen takes `onAddProject?: () => void`; App passes the one that opens AddThreadProjectDialog.
// - Project picker: a popover or menu, always openable, with a filter named thread:dialogs.filterProjects, one option per
//   project folder with its [data-ui=project-dot] and its full path, and "Add project" (thread:dialogs.add).
// - A folder that is no project (rootPath given, not registered) offers Add project on the screen and is never replaced
//   by another project.
// - Agent picker: only installed agents, from window.oxe.agent.getReadiness(): 'missing' is not installed; 'partial' and
//   'unknown' are. A failed or absent read hides nobody. The first installed one is the default.
// - A terminal selection waiting for a new conversation (drafts['new:<projectId or path>'], AG-08) is the screen's
//   message before anything is sent, and is not left over in the created conversation's composer.
// - Acesso shows no level until newConversationAccess() answers, and thread:opening.accessUnreadable (en and pt-BR)
//   when that read fails.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NewConversationScreen } from '../../../src/components/Threads/NewConversationScreen'
import { useThreadStore } from '../../../src/store/thread.store'
import { changeLanguage, i18n } from '../../../src/i18n'
import { threadAgentName } from '../../../shared/threadProviders'
import type { ThreadApi } from '../../../shared/types/thread'

const ROOT = process.cwd()
const tt = (key: string, options: Record<string, unknown> = {}): string => i18n.t(key, { ns: 'thread', ...options }) as string
const ATLAS = { projectId: 'p', displayName: 'Atlas', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'repo' }] }
const BORA = { projectId: 'q', displayName: 'Bora', identityLabel: '/work/bora', hidden: false, contexts: [{ rootPath: '/work/bora', label: 'bora' }] }
const BLOCK = '```text\nnpm ERR! missing script: build\n```\n'
// The wider props are the contract above.
const Screen = NewConversationScreen as (props: { projectId: string; rootPath?: string; onAddProject?: () => void }) => JSX.Element

let api: Record<string, ReturnType<typeof vi.fn>>
let readiness: ReturnType<typeof vi.fn>
const installed = (...ready: string[]) => ['claude', 'codex', 'antigravity'].map(provider => ({ provider, command: provider, status: ready.includes(provider) ? 'ready' : 'missing' }))

function fixture(projects: unknown[] = [ATLAS, BORA]): void {
  const created = { thread: { id: 't-new', workspaceId: 'thread:p', projectId: 'p', rootPath: '/repo', provider: 'claude', title: '', pinned: false, status: 'idle', nativeSessionId: null, createdAt: 1, updatedAt: 1 }, events: [] }
  api = {
    create: vi.fn(async () => created), send: vi.fn(async () => {}), read: vi.fn(async () => created), list: vi.fn(async () => []),
    projects: vi.fn(async () => ({ projects, unavailable: [] })), newConversationAccess: vi.fn(async () => 'full-access'), onChanged: vi.fn(() => () => {})
  }
  readiness = vi.fn(async () => installed('claude', 'codex', 'antigravity'))
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api as unknown as ThreadApi, agent: { getReadiness: readiness, discover: readiness } } })
  useThreadStore.setState({ threads: [], projects, unavailableProjects: [], loading: false, listLoaded: true, selectedId: null, secondaryId: null, snapshot: null, drafts: {} } as never)
}

const row = (): HTMLElement => screen.getByRole('group', { name: tt('opening.context') })
const pickers = (): HTMLElement[] => [...row().querySelectorAll<HTMLElement>('[data-ui="context-picker"]')]
const message = (): HTMLTextAreaElement => screen.getByRole('textbox', { name: tt('composer.message') }) as HTMLTextAreaElement
const send = (): void => { fireEvent.keyDown(message(), { key: 'Enter' }) }
async function openPicker(index: number): Promise<void> {
  expect(pickers()[index], 'the picker can be opened').toBeEnabled()
  await userEvent.setup().click(pickers()[index])
}

beforeEach(() => { localStorage.clear(); fixture() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('CR-a: the project picker (A17)', () => {
  it('lists every project with its dot and full path', async () => {
    render(<Screen projectId="p" />)
    await openPicker(0)
    for (const path of ['/repo', '/work/bora']) expect(await screen.findByText(path), `the path ${path}`).toBeVisible()
    expect(document.querySelectorAll('[data-ui="project-dot"]').length, 'one dot per project').toBeGreaterThanOrEqual(2)
  })

  it('filters by name and by path, and picks what is left', async () => {
    render(<Screen projectId="p" />)
    await openPicker(0)
    const filter = screen.queryByRole('textbox', { name: tt('dialogs.filterProjects') }) ?? screen.queryByRole('searchbox', { name: tt('dialogs.filterProjects') })
    expect(filter, 'Filter projects').not.toBeNull()
    fireEvent.change(filter!, { target: { value: 'work/bo' } })
    await waitFor(() => expect(screen.queryByText('/repo'), 'the filtered-out project').toBeNull())
    await userEvent.setup().click(screen.getByText('/work/bora'))
    await waitFor(() => expect(pickers()[0]).toHaveTextContent('Bora'))
    fireEvent.change(message(), { target: { value: 'Look around' } })
    send()
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ projectId: 'q', rootPath: '/work/bora', provider: 'claude' }))
  })

  it('offers Add project, also with a single project', async () => {
    fixture([ATLAS])
    const onAddProject = vi.fn()
    render(<Screen projectId="p" onAddProject={onAddProject} />)
    await openPicker(0)
    const add = screen.queryByText(tt('dialogs.add'))
    expect(add, 'Add project').not.toBeNull()
    await userEvent.setup().click(add!)
    expect(onAddProject).toHaveBeenCalledTimes(1)
  })

  it('App wires Add project to the screen (SOURCE-TEXT check, marked)', () => {
    const mounted = /<NewConversationScreen\b[\s\S]*?\/>/.exec(readFileSync(join(ROOT, 'src/App.tsx'), 'utf8'))?.[0] ?? ''
    expect(mounted).toMatch(/\bonAddProject=\{/)
  })
})

describe('CR-a: a folder that is not a project', () => {
  it('offers Add project on the screen and never uses another project', async () => {
    const onAddProject = vi.fn()
    render(<Screen projectId="" rootPath="/elsewhere/tool" onAddProject={onAddProject} />)
    expect(row()).not.toHaveTextContent('Atlas')
    fireEvent.change(message(), { target: { value: 'Work here' } })
    send()
    expect(api.create, 'nothing is created in another project').not.toHaveBeenCalled()
    const add = screen.queryByRole('button', { name: tt('dialogs.add') })
    expect(add, 'Add project without opening the picker').not.toBeNull()
    await userEvent.setup().click(add!)
    expect(onAddProject).toHaveBeenCalledTimes(1)
  })
})

describe('CR-a: only installed agents (A17, RN-3)', () => {
  it('lists only the installed agents', async () => {
    readiness.mockResolvedValue(installed('claude', 'codex'))
    render(<Screen projectId="p" />)
    await waitFor(() => expect(readiness, 'the installed agents are read').toHaveBeenCalled())
    await openPicker(1)
    const names = screen.getAllByRole('menuitem').map(item => item.textContent)
    expect(names).toEqual([threadAgentName('claude'), threadAgentName('codex')])
  })

  it('starts on the first installed agent and creates with it', async () => {
    readiness.mockResolvedValue(installed('codex'))
    render(<Screen projectId="p" />)
    await waitFor(() => expect(pickers()[1]).toHaveTextContent(threadAgentName('codex')))
    fireEvent.change(message(), { target: { value: 'Explain the build' } })
    send()
    await waitFor(() => expect(api.create).toHaveBeenCalledWith({ projectId: 'p', rootPath: '/repo', provider: 'codex' }))
  })

  it('creates nothing when no agent is installed', async () => {
    readiness.mockResolvedValue(installed())
    render(<Screen projectId="p" />)
    await waitFor(() => expect(readiness, 'the installed agents are read').toHaveBeenCalled())
    fireEvent.change(message(), { target: { value: 'Explain the build' } })
    await waitFor(() => expect(screen.getByRole('button', { name: tt('composer.send') })).toBeDisabled())
    send()
    expect(api.create).not.toHaveBeenCalled()
  })

  it('counts partial and unknown as installed', async () => {
    readiness.mockResolvedValue([{ provider: 'claude', status: 'partial' }, { provider: 'codex', status: 'unknown' }, { provider: 'antigravity', status: 'missing' }])
    render(<Screen projectId="p" />)
    await waitFor(() => expect(readiness, 'the installed agents are read').toHaveBeenCalled())
    await openPicker(1)
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([threadAgentName('claude'), threadAgentName('codex')])
  })

  it('a failed read hides nobody', async () => {
    readiness.mockRejectedValue(new Error('no answer'))
    render(<Screen projectId="p" />)
    await waitFor(() => expect(readiness, 'the installed agents are read').toHaveBeenCalled())
    await openPicker(1)
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
  })
})

describe('CR-a: a terminal selection on the screen (AG-08, OXE-190)', () => {
  it.each(['new:p', 'new:/repo'])('prefills the message from %s, and sends nothing by itself', async key => {
    useThreadStore.setState({ drafts: { [key]: BLOCK } } as never)
    render(<Screen projectId="p" rootPath="/repo" />)
    await waitFor(() => expect(message().value).toContain(BLOCK.trim()))
    expect(api.create).not.toHaveBeenCalled()
    expect(api.send).not.toHaveBeenCalled()
  })

  it('a selection sent while the screen is open shows too, after what was typed', async () => {
    render(<Screen projectId="p" rootPath="/repo" />)
    fireEvent.change(message(), { target: { value: 'Why does this fail?' } })
    useThreadStore.getState().setDraft('new:p', BLOCK)
    await waitFor(() => expect(message().value).toContain(BLOCK.trim()))
    expect(message().value.startsWith('Why does this fail?')).toBe(true)
    expect(api.send).not.toHaveBeenCalled()
  })

  it('sends what is shown and leaves no copy behind', async () => {
    useThreadStore.setState({ drafts: { 'new:p': BLOCK } } as never)
    render(<Screen projectId="p" rootPath="/repo" />)
    await waitFor(() => expect(message().value).toContain(BLOCK.trim()))
    send()
    await waitFor(() => expect(api.send).toHaveBeenCalledWith('t-new', BLOCK.trim()))
    expect(useThreadStore.getState().drafts['new:p'] ?? '').toBe('')
    expect(useThreadStore.getState().drafts['t-new'] ?? '').toBe('')
  })
})

describe('CR-a: Acesso tells only what was read (A17)', () => {
  const levels = (): string[] => ['read-only', 'workspace-write', 'full-access'].map(level => tt(`opening.access.${level}`))

  it('shows no level until the read answers', async () => {
    let answer: (value: string) => void = () => {}
    api.newConversationAccess.mockImplementation(() => new Promise<string>(resolve => { answer = resolve }))
    render(<Screen projectId="p" />)
    for (const level of levels()) expect(row()).not.toHaveTextContent(level)
    answer('read-only')
    await waitFor(() => expect(row()).toHaveTextContent(tt('opening.access.read-only')))
  })

  it.each(['en', 'pt-BR'])('says so when the read fails (%s)', async locale => {
    await changeLanguage(locale)
    const words = (JSON.parse(readFileSync(join(ROOT, `shared/locales/${locale}/thread.json`), 'utf8')) as { opening: { accessUnreadable?: string } }).opening.accessUnreadable
    expect(words, 'opening.accessUnreadable').toBeTruthy()
    api.newConversationAccess.mockRejectedValue(new Error('database is locked'))
    render(<Screen projectId="p" />)
    await waitFor(() => expect(row()).toHaveTextContent(words!))
    for (const level of levels()) expect(row()).not.toHaveTextContent(level)
  })
})
