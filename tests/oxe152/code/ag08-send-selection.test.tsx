// Acceptance test for 1.5.2 OxeChat/OxeCode bridge (Jira OXE-190, AG-08, CA-1 and CA-2).
// Contract:
// - CA-1: terminalContextMenu / attachTerminalContextMenu shows "Send selection to OxeChat" ("Enviar seleção ao OxeChat")
//   ONLY when text is selected AND the optional onSendToChat callback is provided. Without the callback, the menu keeps
//   exact ['Copy', 'Paste', 'Select all', 'Clear'] (preserving frozen A1 test).
// - CA-2: triggering "Send selection to OxeChat" routes to the matching thread (or new-draft), appends a fenced ```text
//   block (or wider fence if selection contains backticks), dispatches focus below the block, and never sends automatically.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { attachTerminalContextMenu, terminalContextMenu, type TerminalLike } from '../../../src/components/Terminal/terminalContextMenu'
import { appendSelectionToDraft, consumePendingNewDraft, formatSelectionBlock, sendTerminalSelectionToChat } from '../../../src/components/Terminal/terminalToChat'
import { changeLanguage } from '../../../src/i18n'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import type { ConversationThread } from '../../../shared/types/thread'

function fakeTerminal(selection: string): TerminalLike {
  return {
    hasSelection: () => selection.length > 0,
    getSelection: () => selection,
    selectAll: vi.fn(),
    clear: vi.fn(),
    paste: vi.fn(),
    focus: vi.fn()
  }
}

const threadFixture = (overrides: Partial<ConversationThread> = {}): ConversationThread => ({
  id: 'thread-1',
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  rootPath: 'C:/repos/atlas',
  provider: 'claude',
  nativeSessionId: null,
  title: 'Atlas work',
  pinned: false,
  status: 'idle',
  createdAt: 1000,
  updatedAt: 2000,
  ...overrides
})

beforeEach(() => {
  useThreadStore.setState({
    threads: [],
    projects: [],
    selectedId: null,
    snapshot: null,
    drafts: {},
    hiddenProjects: [],
    listLoaded: true
  })
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: null
  })
})

afterEach(async () => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  await changeLanguage('en')
})

const labelsOf = (entries: ReturnType<typeof terminalContextMenu>): string[] =>
  entries.flatMap((entry) => ('label' in entry && typeof entry.label === 'string' ? [entry.label] : []))

describe('OXE-190 · AG-08 terminal selection to OxeChat', () => {
  test('terminal context menu shows Send selection to OxeChat only when text is selected and optional callback is provided', async () => {
    const withSel = fakeTerminal('npm test failed')
    const withoutSel = fakeTerminal('')

    // Without optional callback: exact 4 items (frozen A1 contract).
    expect(labelsOf(terminalContextMenu(withSel, 'npm test failed'))).toEqual(['Copy', 'Paste', 'Select all', 'Clear'])

    // With callback but empty selection: still no Send selection to OxeChat.
    expect(labelsOf(terminalContextMenu(withoutSel, '', { onSendToChat: vi.fn() }))).toEqual(['Copy', 'Paste', 'Select all', 'Clear'])

    // With callback AND non-empty selection: shows Send selection to OxeChat in the AnchoredMenu.
    const host = document.createElement('div')
    document.body.append(host)
    const onSendToChat = vi.fn()
    const handle = attachTerminalContextMenu(host, withSel, { onSendToChat })
    try {
      fireEvent.contextMenu(host, { clientX: 40, clientY: 50 })
      const sendItem = await screen.findByRole('menuitem', { name: 'Send selection to OxeChat' })
      expect(sendItem).toBeTruthy()
      fireEvent.click(sendItem)
      expect(onSendToChat).toHaveBeenCalledWith('npm test failed')
    } finally {
      handle.dispose()
    }

    // In pt-BR, uses the pt-BR catalog label.
    await changeLanguage('pt-BR')
    expect(labelsOf(terminalContextMenu(withSel, 'erro no build', { onSendToChat: vi.fn() }))).toContain('Enviar seleção ao OxeChat')
  })

  test('Send selection to OxeChat appends fenced text block to target thread draft and focuses below without sending', async () => {
    const sendSpy = vi.fn()
    const readSpy = vi.fn(async () => ({ thread: threadFixture(), turns: [] }))
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        thread: {
          send: sendSpy,
          read: readSpy,
          list: vi.fn(async () => [threadFixture()])
        }
      }
    })

    useThreadStore.setState({
      threads: [threadFixture()],
      projects: [{ projectId: 'proj-1', projectName: 'Atlas', rootPath: 'C:/repos/atlas' } as never],
      selectedId: 'thread-1',
      drafts: { 'thread-1': 'Veja esse erro:' },
      listLoaded: true
    })

    const dispatched: CustomEvent[] = []
    const onOpen = (e: Event) => dispatched.push(e as CustomEvent)
    window.addEventListener('oxe:open-thread-draft', onOpen)

    try {
      // Selection containing triple backticks widens the fence to four backticks.
      const selection = 'output:\n```js\nboom()\n```'
      const result = await sendTerminalSelectionToChat({
        selection,
        cwd: 'c:\\repos\\atlas\\'
      })

      expect(result).not.toBeNull()
      expect(result!.target).toEqual({
        kind: 'thread',
        threadId: 'thread-1',
        rootPath: 'C:/repos/atlas'
      })

      const expectedBlock = '````text\noutput:\n```js\nboom()\n```\n````\n'
      expect(formatSelectionBlock(selection)).toBe(expectedBlock)
      expect(appendSelectionToDraft('Veja esse erro:', selection)).toBe(`Veja esse erro:\n\n${expectedBlock}`)
      expect(useThreadStore.getState().drafts['thread-1']).toBe(`Veja esse erro:\n\n${expectedBlock}`)
      expect(sendSpy).not.toHaveBeenCalled()

      await waitFor(() => expect(dispatched).toHaveLength(1))
      expect(dispatched[0].detail).toMatchObject({
        threadId: 'thread-1',
        draftLength: useThreadStore.getState().drafts['thread-1'].length
      })
    } finally {
      window.removeEventListener('oxe:open-thread-draft', onOpen)
    }
  })

  test('new-draft survives thread store reload and transfers to the newly created thread composer', async () => {
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        thread: {
          list: vi.fn(async () => []),
          projects: vi.fn(async () => ({ projects: [{ projectId: 'proj-new', displayName: 'Demo', identityLabel: 'Demo', hidden: false, contexts: [{ rootPath: 'C:/repos/demo', label: 'Demo' }] }], unavailable: [] })),
          addProject: vi.fn(async () => ({ projectId: 'proj-new', displayName: 'Demo', identityLabel: 'Demo', hidden: false, contexts: [{ rootPath: 'C:/repos/demo', label: 'Demo' }] }))
        }
      }
    })

    const result = await sendTerminalSelectionToChat({
      selection: 'OXE190_BRIDGE_OK',
      cwd: 'C:\\repos\\demo\\'
    })
    expect(result?.target).toMatchObject({ kind: 'new-draft', projectId: 'proj-new' })

    // Simulate OxeChat mounting and reloading the thread list while NewThreadDialog is open.
    await useThreadStore.getState().load()

    const transferred = consumePendingNewDraft({
      threadId: 'thread-created-1',
      projectId: 'proj-new',
      rootPath: 'C:/repos/demo'
    })
    expect(transferred).toContain('```text\nOXE190_BRIDGE_OK\n```')
    expect(useThreadStore.getState().drafts['thread-created-1']).toBe(transferred)
  })
})
