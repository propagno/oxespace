// Frozen acceptance test for 1.5.2 OxeChat F2 (OXE program oxespace-152-chat, phase F2, Jira OXE-131).
// Written by the planner; the executor must not edit it.
// Contract:
// - Settings › Agents (the page that holds the conversation settings today: "Access a new conversation starts with",
//   idle conversations) gains "Send message with" (pt-BR "Enviar mensagem com"): a src/ui SegmentedControl
//   (role radiogroup) with two options, "Enter" (factory default, as today) and "Ctrl+Enter" ("Cmd+Enter" on macOS).
//   Rebrand BRD-06 (OXE-67, Settings 720 px, title 20, nav 28, SettingRow): the control sits in a src/ui SettingRow
//   ([data-ui=setting-row]) inside a src/ui SettingsSection ([data-ui=settings-section]); its measures come from those
//   primitives (row label 13/500, section card radius 12 with a 14/600 title, segmented track --control-md 28, tokens
//   in both themes). The choice is kept across restarts (a persisted renderer preference) and applies at once.
// - The OxeChat composer (ThreadComposerForm) and the agent question answer box (the free-text answer of a question
//   card, ThreadRequestCard) follow it through isSendKey (src/components/Threads/sendKey.ts, see the .ts test):
//   "Enter": Enter sends / answers; "Ctrl+Enter": Enter does not send (the composer's line breaks: the key event is
//   not prevented), Ctrl+Enter sends / answers. The diff comment box (src/components/Review/DiffCard.tsx) does not
//   change: Ctrl+Enter saves the comment and Enter alone does not, in both modes.
// - The composer's hint says the right key: in "Enter" mode it names Enter and not Ctrl+Enter; in "Ctrl+Enter" mode
//   it names Ctrl+Enter (the send button title "Send · Enter" is today's hint; any text or title inside the composer
//   form counts). Words go through shared/locales/{en,pt-BR}.
// Runs the real Settings page, ThreadView, DiffCard and stores; only window.oxe is a double.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsContent } from '../../../src/components/Settings/SettingsModal'
import { ThreadView } from '../../../src/components/Threads/ThreadView'
import { DiffCard } from '../../../src/components/Review/DiffCard'
import { useAccountStore } from '../../../src/store/account.store'
import { useDiffCommentsStore } from '../../../src/store/diff-comments.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { changeLanguage } from '../../../src/i18n'
import type { Workspace } from '../../../shared/types/workspace'
import type { ThreadApi, ThreadSnapshot } from '../../../shared/types/thread'
import type { GitDiffFile } from '../../../shared/types/git'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null }) }))

const LABEL = { en: 'Send message with', 'pt-BR': 'Enviar mensagem com' } as const
const settingsProps = { agentProfiles: [], agentReadiness: [], isDiscoveringAgents: false, onClose: vi.fn(), onDiscoverAgents: vi.fn(), onConfigureAgent: vi.fn(), onNewCustomAgent: vi.fn() }

function renderAgentsSettings(): void {
  Object.defineProperty(window, 'oxe', { configurable: true, value: {} })
  render(<SettingsContent section="providers" {...settingsProps} />)
}

/** Chooses the send key the way a person does, in Settings › Agents, and closes Settings. */
async function chooseSendKey(option: 'Enter' | 'Ctrl+Enter'): Promise<void> {
  renderAgentsSettings()
  const group = await screen.findByRole('radiogroup', { name: LABEL.en })
  await userEvent.click(within(group).getByRole('radio', { name: option }))
  await waitFor(() => expect(within(group).getByRole('radio', { name: option })).toHaveAttribute('aria-checked', 'true'))
  cleanup()
}

function fixture(snapshot?: Partial<ThreadSnapshot>) {
  const base: ThreadSnapshot = { thread: { id: 'thread', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude', title: 'Auth investigation', pinned: false, status: 'idle', nativeSessionId: null, createdAt: 1, updatedAt: 1 }, events: [] }
  const value: ThreadSnapshot = { ...base, ...snapshot, thread: { ...base.thread, ...snapshot?.thread } }
  const api = {
    commands: vi.fn(async () => ({ commands: [] })), projects: vi.fn(async () => ({ projects: [], unavailable: [] })),
    list: vi.fn(async () => [value.thread]), create: vi.fn(async () => value), read: vi.fn(async () => value),
    models: vi.fn(async () => ({ defaultModel: 'native-model', models: [{ id: 'native-model', label: 'Native model', description: '', efforts: [], defaultEffort: undefined }] })),
    configure: vi.fn(async () => value), send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}),
    respond: vi.fn(async () => {}), pin: vi.fn(async () => {}), onChanged: vi.fn(() => () => {})
  } as unknown as ThreadApi & { send: ReturnType<typeof vi.fn>; respond: ReturnType<typeof vi.fn> }
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api, clipboard: { writeText: vi.fn(async () => true) }, agentAccount: { read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 })) } } })
  const workspace = { id: 'ws', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useThreadStore.setState({ threads: [value.thread], projects: [{ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }], snapshot: value, selectedId: 'thread', secondaryId: null, snapshotCache: {}, snapshotCacheOrder: [], drafts: {}, errors: {}, hiddenProjects: [] })
  render(<ThreadView workspace={workspace} />)
  return api
}

const questionSnapshot: Partial<ThreadSnapshot> = {
  thread: { status: 'approval' } as ThreadSnapshot['thread'],
  events: [{ type: 'request', id: 'q', request: { id: 'q', nativeId: 'native-q', nativeMethod: 'can_use_tool:AskUserQuestion', kind: 'question', title: 'Claude needs your input', state: 'pending', generation: 1, createdAt: 1, questions: [{ id: 'branch', question: 'Which branch name?' }] } }] as ThreadSnapshot['events']
}

/** Every word the composer shows or titles: its text and the title, placeholder and label attributes inside it. */
function composerHint(): string {
  const form = screen.getByRole('textbox', { name: 'Message' }).closest('form')!
  const attributes = [...form.querySelectorAll('*')].flatMap(element => ['title', 'placeholder', 'aria-label', 'aria-description'].map(name => element.getAttribute(name) ?? ''))
  return [form.textContent ?? '', ...attributes].join(' \n ')
}

const diffFile: GitDiffFile = { path: 'src/foo.ts', additions: 1, deletions: 0, mtime: null, hunks: [{ header: '@@ -1,2 +1,3 @@', lines: [
  { type: 'context', oldLineNo: 1, newLineNo: 1, content: 'const a = 1' },
  { type: 'added', oldLineNo: null, newLineNo: 2, content: 'const b = 2' }
] }] }

/** The diff comment box keeps its own keys: Enter alone saves nothing, Ctrl+Enter saves. */
async function diffCommentKeysUnchanged(): Promise<void> {
  useDiffCommentsStore.setState({ comments: [] })
  render(<DiffCard file={diffFile} workspaceId="ws-1" isReviewed={false} isSelected diffMode="unified" onToggleReviewed={() => undefined} onSelect={() => undefined} />)
  await userEvent.click(screen.getAllByTestId('diff-comment-add')[1])
  const box = await screen.findByPlaceholderText(/Comment for the agent/i)
  fireEvent.change(box, { target: { value: 'null-check this' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  expect(useDiffCommentsStore.getState().comments, 'Enter alone saves nothing').toHaveLength(0)
  fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
  expect(useDiffCommentsStore.getState().comments.map(comment => comment.body)).toEqual(['null-check this'])
  cleanup()
}

beforeEach(() => { localStorage.clear() })
afterEach(async () => { cleanup(); vi.unstubAllGlobals(); await changeLanguage('en') })

describe('OXE-131 · Enter or Ctrl+Enter sends the message', () => {
  it('CA-1 · opção em Settings', async () => {
    renderAgentsSettings()
    const group = await screen.findByRole('radiogroup', { name: LABEL.en })
    const row = group.closest('[data-ui="setting-row"]')
    expect(row, 'the control is a SettingRow').not.toBeNull()
    expect(row!.closest('[data-ui="settings-section"]'), 'inside a SettingsSection').not.toBeNull()
    expect(within(row as HTMLElement).getByText(LABEL.en)).toBeInTheDocument()
    expect(within(group).getAllByRole('radio').map(radio => radio.textContent?.trim())).toEqual(['Enter', 'Ctrl+Enter'])
    expect(within(group).getByRole('radio', { name: 'Enter' }), 'Enter is the factory default').toHaveAttribute('aria-checked', 'true')
    await userEvent.click(within(group).getByRole('radio', { name: 'Ctrl+Enter' }))
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'Ctrl+Enter' })).toHaveAttribute('aria-checked', 'true'))
    cleanup()
    // Kept: Settings opened again shows the choice.
    renderAgentsSettings()
    expect(within(await screen.findByRole('radiogroup', { name: LABEL.en })).getByRole('radio', { name: 'Ctrl+Enter' })).toHaveAttribute('aria-checked', 'true')
    cleanup()
    await changeLanguage('pt-BR')
    renderAgentsSettings()
    expect(await screen.findByRole('radiogroup', { name: LABEL['pt-BR'] })).toBeInTheDocument()
    cleanup()
    await changeLanguage('en')
    await chooseSendKey('Enter')
  })

  it('CA-5 · dica da tecla', async () => {
    await chooseSendKey('Enter')
    fixture()
    expect(composerHint()).toMatch(/Enter/)
    expect(composerHint()).not.toMatch(/Ctrl\+Enter/)
    cleanup()
    await chooseSendKey('Ctrl+Enter')
    fixture()
    expect(composerHint()).toMatch(/Ctrl\+Enter/)
    cleanup()
    await changeLanguage('pt-BR')
    fixture()
    expect(composerHint()).toMatch(/Ctrl\+Enter/)
    cleanup()
    await changeLanguage('en')
    await chooseSendKey('Enter')
  })

  it('CA-6 · onde a escolha vale', async () => {
    // "Ctrl+Enter": the composer breaks the line on Enter and sends on Ctrl+Enter.
    await chooseSendKey('Ctrl+Enter')
    let api = fixture()
    const input = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.change(input, { target: { value: 'first line' } })
    expect(fireEvent.keyDown(input, { key: 'Enter' }), 'Enter is left to the textarea (a new line)').toBe(true)
    expect(api.send).not.toHaveBeenCalled()
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true }) })
    await waitFor(() => expect(api.send).toHaveBeenCalledWith('thread', 'first line', []))
    cleanup()

    // "Ctrl+Enter": the question answer box answers on Ctrl+Enter only.
    api = fixture(questionSnapshot)
    let answer = screen.getByRole('textbox', { name: 'Which branch name?' })
    fireEvent.change(answer, { target: { value: 'feat/x' } })
    fireEvent.keyDown(answer, { key: 'Enter' })
    expect(api.respond).not.toHaveBeenCalled()
    await act(async () => { fireEvent.keyDown(answer, { key: 'Enter', ctrlKey: true }) })
    await waitFor(() => expect(api.respond).toHaveBeenCalledWith('thread', 'q', { answers: { branch: ['feat/x'] } }))
    cleanup()
    await diffCommentKeysUnchanged()

    // "Enter": the question answer box answers on Enter, as the composer sends on Enter.
    await chooseSendKey('Enter')
    api = fixture(questionSnapshot)
    answer = screen.getByRole('textbox', { name: 'Which branch name?' })
    fireEvent.change(answer, { target: { value: 'feat/y' } })
    await act(async () => { fireEvent.keyDown(answer, { key: 'Enter' }) })
    await waitFor(() => expect(api.respond).toHaveBeenCalledWith('thread', 'q', { answers: { branch: ['feat/y'] } }))
    cleanup()
    await diffCommentKeysUnchanged()
  })
})
