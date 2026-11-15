// Frozen acceptance test for 1.5.2 OxeChat F2 (OXE program oxespace-152-chat, phase F2, Jira OXE-131; v3, CR-F2-2).
// Written by the planner; the executor must not edit it. (The key rule tests that were in oxe-131-send-key.test.ts live
// here since v3: one file per criterion.)
// Contract:
// - src/components/Threads/sendKey.ts (new) exports
//     type SendKeyMode = 'enter' | 'ctrl-enter'
//     isSendKey(event: { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean;
//                        isComposing?: boolean; keyCode?: number }, mode: SendKeyMode, mac?: boolean): boolean
//     sendKeyLabel(mode: SendKeyMode, mac?: boolean): string   ('Enter'; 'Ctrl+Enter', or '⌘+Enter' on macOS)
//   `mac` defaults to the platform (IS_MAC, src/keyboard/chords.ts); these tests pass it.
//   "enter" (factory default, as today): Enter sends, Shift+Enter does not (the line breaks); Ctrl+Enter and Cmd+Enter
//   still send, as today. "ctrl-enter": Enter and Shift+Enter do not send; Ctrl+Enter sends, Cmd+Enter on macOS.
//   An IME composition (`isComposing`, or the legacy keyCode 229) never sends, in either mode.
// - Settings › Agents (the page with the conversation settings today) gains "Send message with" (pt-BR "Enviar mensagem
//   com"): a src/ui SegmentedControl (role radiogroup) with the options sendKeyLabel gives: "Enter" (default) and
//   "Ctrl+Enter" on Windows and Linux ("⌘+Enter" on macOS). Rebrand, brand answers of 14/11 (CR-F2-2; BRD-06/OXE-67, one
//   mould, no cards): the control is a src/ui SettingRow ([data-ui=setting-row], label left, control right) inside a
//   src/ui SettingsSection with a title ([data-ui=settings-section]) that is the LAST thing on the page and is NOT a
//   card: SettingsSection gains a `plain` variant (prop `plain`, rendered as data-variant="plain") whose CSS rule in
//   src/ui/Settings.module.css sets no border and no background (SOURCE-TEXT check, marked below). The other sections
//   keep their look. The choice is kept across restarts (a persisted renderer preference) and applies at once.
//   SettingsModal.tsx is at its file-size baseline (1093): to add the section at the end of the Agents page, move
//   IdleConversationsSetting out of it (next to the new setting) so the file does not grow.
// - The OxeChat composer (ThreadComposerForm) and the agent question answer box (the free-text answer of a question
//   card, ThreadRequestCard) follow isSendKey: "Enter": Enter sends / answers; "Ctrl+Enter": Enter does not send (the
//   composer's line breaks: the key event is not prevented), Ctrl+Enter sends / answers. The diff comment box
//   (src/components/Review/DiffCard.tsx) does not change: Ctrl+Enter saves, Enter alone does not, in both modes.
// - The composer's hint names the chosen key (sendKeyLabel): in "Enter" mode Enter and not Ctrl+Enter; in "Ctrl+Enter"
//   mode Ctrl+Enter (the send button title "Send · Enter" is today's hint; any text or title inside the composer form
//   counts). Words go through shared/locales/{en,pt-BR}.
// Runs the real Settings page, ThreadView, DiffCard and stores; only window.oxe is a double.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isSendKey, sendKeyLabel } from '../../../src/components/Threads/sendKey'
import { SettingsContent } from '../../../src/components/Settings/SettingsModal'
import { ThreadView } from '../../../src/components/Threads/ThreadView'
import { DiffCard } from '../../../src/components/Review/DiffCard'
import { useAccountStore } from '../../../src/store/account.store'
import { useDiffCommentsStore } from '../../../src/store/diff-comments.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { changeLanguage, i18n } from '../../../src/i18n'
import enThread from '../../../shared/locales/en/thread.json'
import ptThread from '../../../shared/locales/pt-BR/thread.json'
import type { Workspace } from '../../../shared/types/workspace'
import type { ThreadApi, ThreadSnapshot } from '../../../shared/types/thread'
import type { GitDiffFile } from '../../../shared/types/git'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null }) }))

// ---- the key rule
const enter = { key: 'Enter' }
const shiftEnter = { key: 'Enter', shiftKey: true }
const ctrlEnter = { key: 'Enter', ctrlKey: true }
const cmdEnter = { key: 'Enter', metaKey: true }

// ---- Settings › Agents
const LABEL = { en: 'Send message with', 'pt-BR': 'Enviar mensagem com' } as const
const settingsProps = { agentProfiles: [], agentReadiness: [], isDiscoveringAgents: false, onClose: vi.fn(), onDiscoverAgents: vi.fn(), onConfigureAgent: vi.fn(), onNewCustomAgent: vi.fn() }

function renderAgentsSettings(): HTMLElement {
  Object.defineProperty(window, 'oxe', { configurable: true, value: {} })
  return render(<SettingsContent section="providers" {...settingsProps} />).container
}

/** Chooses the send key the way a person does, in Settings › Agents, and closes Settings. */
async function chooseSendKey(option: 'Enter' | 'Ctrl+Enter'): Promise<void> {
  renderAgentsSettings()
  const group = await screen.findByRole('radiogroup', { name: LABEL.en })
  await userEvent.click(within(group).getByRole('radio', { name: option }))
  await waitFor(() => expect(within(group).getByRole('radio', { name: option })).toHaveAttribute('aria-checked', 'true'))
  cleanup()
}

/** Nothing with words comes after `element` on the page. */
function nothingAfter(page: HTMLElement, element: HTMLElement): string[] {
  return [...page.querySelectorAll('*')]
    .filter(node => !element.contains(node) && !node.contains(element) && (element.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING))
    .map(node => (node.textContent ?? '').trim()).filter(Boolean)
}

// ---- the conversation
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

/** The composer's accessible name in the interface language, from the catalogs (thread:composer.message). */
const messageName = (): string => (i18n.language === 'pt-BR' ? ptThread : enThread).composer.message

/** A conversation with one message: the composer is on screen, whatever the empty state looks like. */
const withMessage: Partial<ThreadSnapshot> = { events: [{ type: 'message', id: 'm1', role: 'user', text: 'Hello' }] as ThreadSnapshot['events'] }

/** Every word the composer shows or titles: its text and the title, placeholder and label attributes inside it. */
function composerHint(): string {
  const box = screen.queryByRole('textbox', { name: messageName() })
  expect(box, `the composer ("${messageName()}") is on screen`).not.toBeNull()
  const form = box!.closest('form')!
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

describe('OXE-131 · which key sends the message', () => {
  it('CA-2 · modo Enter', () => {
    for (const mac of [false, true]) {
      expect(isSendKey(enter, 'enter', mac), `Enter sends (mac ${mac})`).toBe(true)
      expect(isSendKey(shiftEnter, 'enter', mac), `Shift+Enter breaks the line (mac ${mac})`).toBe(false)
      expect(isSendKey({ key: 'a' }, 'enter', mac)).toBe(false)
      expect(isSendKey({ key: 'a', ctrlKey: true }, 'enter', mac)).toBe(false)
      expect(sendKeyLabel('enter', mac)).toBe('Enter')
    }
    expect(isSendKey(ctrlEnter, 'enter', false), 'Ctrl+Enter still sends').toBe(true)
    expect(isSendKey(cmdEnter, 'enter', true), 'Cmd+Enter still sends on macOS').toBe(true)
  })

  it('CA-3 · modo Ctrl+Enter', () => {
    for (const mac of [false, true]) {
      expect(isSendKey(enter, 'ctrl-enter', mac), `Enter breaks the line (mac ${mac})`).toBe(false)
      expect(isSendKey(shiftEnter, 'ctrl-enter', mac), `Shift+Enter breaks the line (mac ${mac})`).toBe(false)
      expect(isSendKey({ key: 'a', ctrlKey: true }, 'ctrl-enter', mac)).toBe(false)
    }
    expect(isSendKey(ctrlEnter, 'ctrl-enter', false), 'Ctrl+Enter sends on Windows and Linux').toBe(true)
    expect(isSendKey(cmdEnter, 'ctrl-enter', true), 'Cmd+Enter sends on macOS').toBe(true)
    expect(sendKeyLabel('ctrl-enter', false)).toBe('Ctrl+Enter')
    expect(sendKeyLabel('ctrl-enter', true)).toBe('⌘+Enter')
  })

  it('CA-4 · IME nunca envia', () => {
    for (const mode of ['enter', 'ctrl-enter'] as const) {
      for (const mac of [false, true]) {
        for (const event of [enter, shiftEnter, ctrlEnter, cmdEnter]) {
          expect(isSendKey({ ...event, isComposing: true }, mode, mac), `${mode} ${JSON.stringify(event)} composing (mac ${mac})`).toBe(false)
          expect(isSendKey({ ...event, keyCode: 229 }, mode, mac), `${mode} ${JSON.stringify(event)} keyCode 229 (mac ${mac})`).toBe(false)
        }
      }
    }
  })
})

describe('OXE-131 · Enter or Ctrl+Enter sends the message', () => {
  it('CA-1 · opção em Settings', async () => {
    const page = renderAgentsSettings()
    const group = await screen.findByRole('radiogroup', { name: LABEL.en })
    const row = group.closest<HTMLElement>('[data-ui="setting-row"]')
    expect(row, 'the control is a SettingRow').not.toBeNull()
    const section = row!.closest<HTMLElement>('[data-ui="settings-section"]')
    expect(section, 'inside a SettingsSection').not.toBeNull()
    expect(within(section!).getByRole('heading'), 'the section has a title').toBeInTheDocument()
    expect(section, 'no card: the plain SettingsSection').toHaveAttribute('data-variant', 'plain')
    expect(nothingAfter(page, section!), 'the section is the last thing on the page').toEqual([])
    expect(within(row!).getByText(LABEL.en)).toBeInTheDocument()
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
    // SOURCE-TEXT check (marked): the plain variant of SettingsSection draws no card (no border, no background).
    const css = readFileSync(join(__dirname, '..', '..', '..', 'src', 'ui', 'Settings.module.css'), 'utf8')
    const plain = [...css.matchAll(/([^{}]*\.plain[^{}]*)\{([^}]*)\}/g)].map(match => match[2]).join('\n')
    expect(plain, 'a .plain rule exists in Settings.module.css').not.toBe('')
    expect(plain).toMatch(/border:\s*(0|none)\b/)
    expect(plain).toMatch(/background:\s*(none|transparent)\b/)
  })

  it('CA-5 · dica da tecla', async () => {
    await chooseSendKey('Enter')
    fixture(withMessage)
    expect(composerHint()).toMatch(/Enter/)
    expect(composerHint()).not.toMatch(/Ctrl\+Enter/)
    cleanup()
    await chooseSendKey('Ctrl+Enter')
    fixture(withMessage)
    expect(composerHint()).toMatch(/Ctrl\+Enter/)
    cleanup()
    await changeLanguage('pt-BR')
    fixture(withMessage)
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
