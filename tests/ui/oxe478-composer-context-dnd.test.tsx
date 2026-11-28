import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationThread, ThreadSnapshot } from '../../shared/types/thread'
import type { Workspace } from '../../shared/types/workspace'
import { ThreadView } from '../../src/components/Threads/ThreadView'
import { changeLanguage } from '../../src/i18n'
import { clearFileListCache } from '../../src/lib/fileListCache'
import { useAccountStore } from '../../src/store/account.store'
import { useTerminalStore } from '../../src/store/terminal.store'
import { PASTE_AS_ATTACHMENT_DEFAULT, useThreadPrefs } from '../../src/store/thread-prefs.store'
import { useThreadStore } from '../../src/store/thread.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'

vi.mock('../../src/hooks/useGitBranch', () => ({
  useGitBranch: () => ({ branch: 'feat/oxe-478', detached: false, shortSha: 'abc1234', error: null })
}))

const ROOT = join(__dirname, '..', '..')
const readCss = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const priorOxe = Object.getOwnPropertyDescriptor(window, 'oxe')

interface SetupOptions {
  rootPath?: string
  files?: string[]
  otherThreads?: Partial<ConversationThread>[]
  getPathForFile?: (file: File) => string
  sendImpl?: (...args: unknown[]) => Promise<void>
}

function setupView(options: SetupOptions = {}) {
  const rootPath = options.rootPath ?? '/repo'
  const mainThread: ConversationThread = {
    id: 'thread-main',
    workspaceId: 'ws-1',
    projectId: 'proj-1',
    rootPath,
    provider: 'claude',
    nativeSessionId: 'native-main',
    title: 'Current task',
    pinned: false,
    status: 'idle',
    createdAt: 100,
    updatedAt: 200,
    access: 'workspace-write',
    mode: 'default'
  }
  const others: ConversationThread[] = (options.otherThreads ?? [
    { id: 'thread-auth', title: 'Auth refactor', provider: 'codex', projectId: 'proj-1', updatedAt: 190 },
    { id: 'thread-billing', title: 'Billing fixes', provider: 'claude', projectId: 'proj-2', updatedAt: 150 }
  ]).map((item, idx) => ({
    ...mainThread,
    id: item.id ?? `thread-other-${idx}`,
    title: item.title ?? `Other ${idx}`,
    provider: item.provider ?? 'claude',
    projectId: item.projectId ?? 'proj-1',
    updatedAt: item.updatedAt ?? 100 - idx,
    ...item
  }))

  const snapshot: ThreadSnapshot = { thread: mainThread, events: [] }
  const send = vi.fn(options.sendImpl ?? (async () => undefined))
  const sendTyped = vi.fn(options.sendImpl ?? (async () => undefined))
  const attach = vi.fn(async (_id: string, input: { name: string; mimeType: string; data: ArrayBuffer }) => ({
    id: `att-${input.name}`,
    name: input.name,
    mimeType: input.mimeType,
    bytes: input.data.byteLength
  }))
  const listFiles = vi.fn(async () => ({
    files: options.files ?? ['src/app.ts', 'src/components/Button.tsx', 'src/ui/Menu.tsx', 'README.md']
  }))

  const api = {
    commands: vi.fn(async () => ({ commands: [] })),
    projects: vi.fn(async () => ({ projects: [], unavailable: [] })),
    list: vi.fn(async () => [mainThread, ...others]),
    create: vi.fn(async () => snapshot),
    read: vi.fn(async () => snapshot),
    models: vi.fn(async () => ({
      defaultModel: 'claude-sonnet',
      models: [{ id: 'claude-sonnet', label: 'Sonnet', description: '', efforts: ['low', 'high'], defaultEffort: 'low' }]
    })),
    configure: vi.fn(async () => snapshot),
    send,
    sendTyped,
    steer: vi.fn(async () => undefined),
    steerTyped: vi.fn(async () => undefined),
    interrupt: vi.fn(async () => undefined),
    approve: vi.fn(async () => undefined),
    respond: vi.fn(async () => undefined),
    pin: vi.fn(async () => undefined),
    attach,
    removeAttachment: vi.fn(async () => undefined),
    onChanged: vi.fn(() => () => undefined),
    command: vi.fn(async () => ({ kind: 'applied' })),
    turnFiles: vi.fn(async () => []),
    places: vi.fn(async () => ({ places: [], capped: false, refused: 0 })),
    onPlacesChanged: vi.fn(() => () => undefined),
    collisions: vi.fn(async () => []),
    panes: vi.fn(async () => [])
  }

  Object.defineProperty(window, 'oxe', {
    configurable: true,
    value: {
      app: {
        platform: 'linux',
        getPathForFile: options.getPathForFile
      },
      thread: api,
      search: { listFiles },
      fs: { listTree: vi.fn(async () => []) },
      clipboard: { writeText: vi.fn(async () => true) },
      agentAccount: {
        read: vi.fn(async () => ({
          provider: 'claude',
          scopeId: 'test',
          state: 'connected',
          method: 'subscription',
          checkedAt: 1
        }))
      }
    }
  })

  const workspace = { id: 'ws-1', name: 'Repo', rootPath, panes: [] } as unknown as Workspace
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useTerminalStore.setState({ panes: {}, pendingCommands: {}, activePaneId: null })
  useThreadPrefs.setState({ pasteAsAttachmentThreshold: PASTE_AS_ATTACHMENT_DEFAULT })
  useThreadStore.setState({
    threads: [mainThread, ...others],
    projects: [{ projectId: 'proj-1', displayName: 'Repo', identityLabel: rootPath, hidden: false, contexts: [{ rootPath, label: 'Repo' }] }],
    snapshot,
    selectedId: mainThread.id,
    secondaryId: null,
    drafts: {},
    attachments: {},
    previewElements: {},
    contextItems: {}
  } as never)

  const rendered = render(<ThreadView workspace={workspace} />)
  const composer = rendered.container.querySelector<HTMLFormElement>('[data-ui="composer"]')!
  const textarea = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
  return { ...rendered, composer, textarea, api, send, sendTyped, attach, listFiles, mainThread }
}

function makeFile(name: string, content: string, type: string, fullPath?: string): File {
  const file = new File([content], name, { type })
  if (fullPath) {
    Object.defineProperty(file, 'path', { value: fullPath, configurable: true })
  }
  // Ensure arrayBuffer works reliably in jsdom even for small synthetic files.
  if (typeof file.arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new TextEncoder().encode(content).buffer
    })
  }
  return file
}

beforeEach(async () => {
  localStorage.clear()
  clearFileListCache()
  await changeLanguage('en')
})

afterEach(async () => {
  cleanup()
  clearFileListCache()
  if (priorOxe) Object.defineProperty(window, 'oxe', priorOxe)
  else Reflect.deleteProperty(window, 'oxe')
  vi.restoreAllMocks()
  await changeLanguage('en')
})

describe('OXE-478 · OxeChat Composer Context & Drag-and-Drop', () => {
  describe('1. Drag-and-drop of files, folders, and images', () => {
    it('attaches dropped .ts files and folders as deduplicated chips while preserving image uploads and dropzone highlight', async () => {
      const tsFile = makeFile('app.ts', 'export const x = 1', 'text/typescript', '/repo/src/app.ts')
      const dupTsFile = makeFile('app.ts', 'export const x = 1', 'text/typescript', '/repo/src/app.ts')
      const folderEntry = makeFile('components', '', '', '/repo/src/components')
      const pngFile = makeFile('shot.png', 'png-bytes', 'image/png', '/repo/shot.png')

      const { composer, textarea, send, attach } = setupView({
        getPathForFile: file => (file as File & { path?: string }).path ?? ''
      })

      // DragOver activates the subtle hairline dropzone highlight.
      fireEvent.dragOver(composer, {
        dataTransfer: {
          types: ['Files'],
          items: [{ kind: 'file' }],
          files: [tsFile],
          dropEffect: 'none'
        }
      })
      expect(composer).toHaveAttribute('data-drop-active', 'true')

      // DragLeave clears the highlight when leaving the composer surface.
      fireEvent.dragLeave(composer, { relatedTarget: document.body })
      expect(composer).not.toHaveAttribute('data-drop-active')

      // Drop a mix of .ts file (twice), a folder, and an image at once.
      await act(async () => {
        fireEvent.drop(composer, {
          dataTransfer: {
            types: ['Files'],
            files: [tsFile, dupTsFile, folderEntry, pngFile],
            items: [
              { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) },
              { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) },
              { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) },
              { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }
            ],
            getData: () => ''
          }
        })
      })

      // Image still routes to api.attach!
      await waitFor(() => expect(attach).toHaveBeenCalledTimes(1))
      expect(attach.mock.calls[0][1]).toMatchObject({ name: 'shot.png', mimeType: 'image/png' })

      // Non-image files & folders appear as quiet deduplicated chips (1 file + 1 folder, no duplicate app.ts).
      const chipBar = screen.getByTestId('composer-context-chips')
      const chips = within(chipBar).getAllByTestId('composer-context-chip')
      expect(chips).toHaveLength(2)
      expect(chips[0]).toHaveAttribute('data-context-kind', 'file')
      expect(chips[0]).toHaveTextContent('app.ts')
      expect(chips[1]).toHaveAttribute('data-context-kind', 'folder')
      expect(chips[1]).toHaveTextContent('components/')

      // Dropping the exact same file again does NOT duplicate the chip.
      fireEvent.drop(composer, {
        dataTransfer: {
          types: ['Files'],
          files: [tsFile],
          items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }],
          getData: () => ''
        }
      })
      expect(within(screen.getByTestId('composer-context-chips')).getAllByTestId('composer-context-chip')).toHaveLength(2)

      // Type a prompt and submit -> normalized workspace-relative directives are serialized and chips clear!
      fireEvent.change(textarea, { target: { value: 'Inspect these files' } })
      await act(async () => {
        fireEvent.submit(composer)
      })
      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0][1]).toBe('Inspect these files\n\n@src/app.ts @folder:src/components')
      expect(screen.queryByTestId('composer-context-chips')).toBeNull()
    })

    it('accepts internal workspace explorer drops (application/oxe-file-path) and outside-workspace files cleanly', () => {
      const { composer } = setupView({ rootPath: 'C:\\Work\\oxe' })

      // Workspace explorer file drag with quoted path containing spaces.
      fireEvent.drop(composer, {
        dataTransfer: {
          types: ['application/oxe-file-path', 'application/oxe-file-kind'],
          files: [],
          items: [],
          getData: (type: string) =>
            type === 'application/oxe-file-path'
              ? '"C:\\Work\\oxe\\docs\\my spec.md"'
              : type === 'application/oxe-file-kind'
                ? 'file'
                : ''
        }
      })

      // External URI drop outside the workspace.
      fireEvent.drop(composer, {
        dataTransfer: {
          types: ['text/uri-list'],
          files: [],
          items: [],
          getData: (type: string) => type === 'text/uri-list' ? 'file:///C:/External/notes.txt\n' : ''
        }
      })

      const chips = within(screen.getByTestId('composer-context-chips')).getAllByTestId('composer-context-chip')
      expect(chips).toHaveLength(2)
      expect(chips[0]).toHaveAttribute('title', 'docs/my spec.md')
      expect(chips[1]).toHaveAttribute('title', 'C:/External/notes.txt')
      expect(chips[1]).toHaveTextContent('outside')
    })
  })

  describe('2. Paste-as-Attachment (>10,000 chars)', () => {
    it('converts pastes >10,000 chars into a removable previewable chip and includes content on submit', async () => {
      const user = userEvent.setup()
      const { composer, textarea, send } = setupView()
      const longLines = Array.from({ length: 412 }, (_, idx) => `line-${idx + 1}: ${'x'.repeat(24)}`).join('\n')
      expect(longLines.length).toBeGreaterThan(10_000)

      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          files: [],
          getData: (type: string) => (type === 'text/plain' ? longLines : '')
        }
      })
      act(() => { textarea.dispatchEvent(pasteEvent) })

      expect(pasteEvent.defaultPrevented).toBe(true)
      expect(textarea.value).toBe('')

      const chip = screen.getByTestId('composer-context-chip')
      expect(chip).toHaveAttribute('data-context-kind', 'pasted-text')
      expect(chip).toHaveTextContent('Pasted text · 412 lines')

      // Click chip to preview the pasted content.
      await user.click(within(chip).getByRole('button', { name: /^Pasted text · 412 lines/ }))
      const preview = await screen.findByTestId('pasted-text-preview')
      expect(preview).toHaveTextContent('line-1:')

      // Close popover and submit -> full pasted content is serialized cleanly with delimiters!
      await user.keyboard('{Escape}')
      fireEvent.change(textarea, { target: { value: 'Summarize this log' } })
      await act(async () => { fireEvent.submit(composer) })

      expect(send).toHaveBeenCalledTimes(1)
      const outgoing = send.mock.calls[0][1] as string
      expect(outgoing).toContain('Summarize this log')
      expect(outgoing).toContain(`<pasted_text lines="412" chars="${longLines.length}">`)
      expect(outgoing).toContain('line-412:')
      expect(outgoing).toContain('</pasted_text>')
      expect(screen.queryByTestId('composer-context-chips')).toBeNull()
    })

    it('lets the user inline a pasted chip into the textarea or remove it with ×', async () => {
      const user = userEvent.setup()
      const { textarea } = setupView()
      const longText = 'A'.repeat(10_050)

      fireEvent.paste(textarea, {
        clipboardData: { files: [], getData: () => longText }
      })

      const chip = screen.getByTestId('composer-context-chip')
      await user.click(within(chip).getByRole('button', { name: /^Pasted text/ }))
      await user.click(await screen.findByRole('button', { name: 'Insert into message' }))
      expect(textarea.value).toBe(longText)
      expect(screen.queryByTestId('composer-context-chips')).toBeNull()

      // Paste again and remove via × button.
      fireEvent.change(textarea, { target: { value: '' } })
      fireEvent.paste(textarea, {
        clipboardData: { files: [], getData: () => longText }
      })
      const removeBtn = screen.getByRole('button', { name: /Remove Pasted text/ })
      await user.click(removeBtn)
      expect(screen.queryByTestId('composer-context-chips')).toBeNull()
    })

    it('inserts pastes <=10,000 chars normally and disables conversion when pasteAsAttachmentThreshold is 0', () => {
      const { textarea } = setupView()

      // Exactly 10,000 chars -> does NOT convert to attachment chip.
      const exactText = 'b'.repeat(10_000)
      const exactEvent = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(exactEvent, 'clipboardData', {
        value: { files: [], getData: () => exactText }
      })
      act(() => { textarea.dispatchEvent(exactEvent) })
      expect(exactEvent.defaultPrevented).toBe(false)
      expect(screen.queryByTestId('composer-context-chips')).toBeNull()

      // Threshold = 0 -> even 15,000 chars does NOT convert.
      act(() => { useThreadPrefs.getState().setPasteAsAttachmentThreshold(0) })
      const hugeText = 'c'.repeat(15_000)
      const disabledEvent = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(disabledEvent, 'clipboardData', {
        value: { files: [], getData: () => hugeText }
      })
      act(() => { textarea.dispatchEvent(disabledEvent) })
      expect(disabledEvent.defaultPrevented).toBe(false)
      expect(screen.queryByTestId('composer-context-chips')).toBeNull()
    })
  })

  describe('3. @ menu and + Context sources: @changes, @terminal, @folder, @thread', () => {
    it('exposes @changes, @terminal, @folder, @thread via @ fuzzy menu, creates removable chips, and serializes on send', async () => {
      const { composer, textarea, send } = setupView()
      useTerminalStore.setState({
        panes: {
          'thread-shell:thread-main:1': {
            status: 'running',
            error: null,
            lastActivityAt: 500,
            lastOutput: 'npm test',
            lastIntent: null,
            lastIntentAt: null,
            isWorking: false,
            hasUnread: false,
            hookState: null,
            agentState: null,
            agentSource: null,
            agentName: null,
            hookAt: null,
            location: null,
            shellCommand: null,
            detached: false
          }
        },
        pendingCommands: {},
        activePaneId: null
      })

      // 1. Typing `@` shows all 4 built-in sources alongside files.
      fireEvent.change(textarea, { target: { value: '@', selectionStart: 1 } })
      const listbox = await screen.findByRole('listbox', { name: 'Project files' })
      const optionNames = within(listbox).getAllByRole('option').map(el => el.textContent ?? '')
      expect(optionNames.some(text => text.includes('@changes'))).toBe(true)
      expect(optionNames.some(text => text.includes('@terminal'))).toBe(true)
      expect(optionNames.some(text => text.includes('@folder'))).toBe(true)
      expect(optionNames.some(text => text.includes('@thread'))).toBe(true)

      // 2. Fuzzy match `@ch` -> select `@changes` with Enter -> creates chip and clears `@ch`.
      fireEvent.change(textarea, { target: { value: '@ch', selectionStart: 3 } })
      fireEvent.keyDown(textarea, { key: 'Enter' })
      expect(textarea.value).toBe('')
      expect(screen.getByTestId('composer-context-chip')).toHaveAttribute('data-context-kind', 'changes')

      // 3. Fuzzy match `@ter` -> select `@terminal` -> creates chip bound to the running thread shell!
      fireEvent.change(textarea, { target: { value: '@ter', selectionStart: 4 } })
      fireEvent.keyDown(textarea, { key: 'Enter' })
      expect(screen.getAllByTestId('composer-context-chip').some(el => el.dataset.contextKind === 'terminal')).toBe(true)

      // 4. Select `@folder` -> opens inline folder picker -> pick `src/ui`.
      fireEvent.change(textarea, { target: { value: '@fol', selectionStart: 4 } })
      fireEvent.keyDown(textarea, { key: 'Enter' })
      expect(textarea.value).toBe('@folder:')
      const folderBox = await screen.findByRole('listbox', { name: 'Project folders' })
      const uiFolderOption = within(folderBox).getAllByRole('option').find(el => (el.textContent ?? '').includes('src/ui'))!
      fireEvent.mouseDown(uiFolderOption)
      expect(screen.getAllByTestId('composer-context-chip').some(el => el.dataset.contextKind === 'folder' && el.textContent?.includes('ui/'))).toBe(true)

      // 5. Select `@thread` -> opens inline conversation picker (excluding current thread) -> pick `Auth refactor`.
      fireEvent.change(textarea, { target: { value: '@thr', selectionStart: 4 } })
      fireEvent.keyDown(textarea, { key: 'Enter' })
      expect(textarea.value).toBe('@thread:')
      const threadBox = await screen.findByRole('listbox', { name: 'Conversations' })
      const threadOptions = within(threadBox).getAllByRole('option')
      expect(threadOptions.some(el => (el.textContent ?? '').includes('Current task'))).toBe(false)
      const authOption = threadOptions.find(el => (el.textContent ?? '').includes('Auth refactor'))!
      fireEvent.mouseDown(authOption)
      expect(screen.getAllByTestId('composer-context-chip').some(el => el.dataset.contextKind === 'thread' && el.textContent?.includes('Auth refactor'))).toBe(true)

      // 6. Submit -> all 4 context directives arrive cleanly in outgoing payload and chips clear!
      fireEvent.change(textarea, { target: { value: 'Check everything' } })
      await act(async () => { fireEvent.submit(composer) })
      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0][1]).toBe(
        'Check everything\n\n@changes @terminal:thread-shell:thread-main:1 @folder:src/ui @thread:thread-auth'
      )
      expect(screen.queryByTestId('composer-context-chips')).toBeNull()
    })

    it('exposes Git changes, Terminal output, Folder, and Conversation inside the + Context menu', async () => {
      const user = userEvent.setup()
      const { composer, textarea } = setupView()
      const toolbar = composer.querySelector<HTMLElement>('[data-ui="composer-toolbar"]')!

      await user.click(within(toolbar).getByRole('button', { name: 'Context' }))
      const menu = await screen.findByRole('menu')
      const labels = within(menu).getAllByRole('menuitem').map(el => el.textContent?.trim() ?? '')

      expect(labels.some(text => text.startsWith('Git changes'))).toBe(true)
      expect(labels.some(text => text.startsWith('Terminal output'))).toBe(true)
      expect(labels.some(text => text.startsWith('Folder'))).toBe(true)
      expect(labels.some(text => text.startsWith('Conversation'))).toBe(true)

      // Selecting Git changes from + Context immediately creates the @changes chip.
      await user.click(within(menu).getAllByRole('menuitem').find(el => (el.textContent ?? '').startsWith('Git changes'))!)
      expect(screen.getByTestId('composer-context-chip')).toHaveAttribute('data-context-kind', 'changes')

      // Selecting Folder from + Context opens the inline folder picker cleanly.
      await user.click(within(toolbar).getByRole('button', { name: 'Context' }))
      const menu2 = await screen.findByRole('menu')
      await user.click(within(menu2).getAllByRole('menuitem').find(el => (el.textContent ?? '').startsWith('Folder'))!)
      expect(textarea.value).toBe('@folder:')
      expect(await screen.findByRole('listbox', { name: 'Project folders' })).toBeInTheDocument()
    })
  })

  describe('4. Obsidian Minimal semantic CSS contract', () => {
    it('uses only semantic CSS tokens with zero hardcoded hex colors in composer context styles', () => {
      const chipsCss = readCss('src/components/Threads/ComposerContextChips.module.css')
      const composerCss = readCss('src/components/Threads/ThreadComposerChrome.css')
      expect(chipsCss).not.toMatch(/#[0-9a-f]{3,8}\b/i)
      expect(composerCss).not.toMatch(/#[0-9a-f]{3,8}\b/i)
      expect(composerCss).toMatch(/\.thread-composer\[data-ui='composer'\]\[data-drop-active='true'\]/)
      expect(chipsCss).toMatch(/border:\s*1px solid var\(--bd-subtle\)/)
      expect(chipsCss).toMatch(/background:\s*var\(--surface-sunken\)/)
    })
  })
})
