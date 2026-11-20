// Acceptance test for 1.5.2 (Jira OXE-12, ref-MENU-R3, CA-1 to CA-3).
// Contract:
// - CA-1: in OxeChat with an open workspace, choosing an OxeCode item in View or Tools switches to OxeCode and runs it,
//   just like in OxeQuery.
// - CA-2: with no workspace open, OxeCode items in View and Tools are unavailable with a reason (#771 pattern, never
//   plain grey disabled) in both OxeChat and OxeQuery.
// - CA-3: given the same workspace/pane state, OxeCode items in View and Tools have the exact same enabled/unavailable
//   state in both OxeChat and OxeQuery.
import { describe, expect, test, vi } from 'vitest'
import { buildCodeCommands } from '../../src/commands/code.commands'
import { buildAppMenus, type AppMenu, type AppMenuNode } from '../../src/components/Navigation/appMenus'
import type { AppView } from '../../src/keyboard/keybindings'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'

const PANE: WorkspacePane = {
  id: 'pane-1',
  workspaceId: 'ws-1',
  type: 'terminal',
  rowIndex: 0,
  columnIndex: 0,
  shellProfileId: 'builtin-claude',
  status: 'idle',
  agentProfileId: null,
  agentName: null,
  displayName: null,
  createdAt: null,
  rootPath: null
} as WorkspacePane

const WORKSPACE: Workspace = {
  id: 'ws-1',
  name: 'Atlas',
  rootPath: 'C:/repos/atlas',
  layout: '1x1',
  layoutPreset: 1,
  themeId: 'dracula',
  uiDensity: 'compact',
  defaultShellProfileId: 'builtin-claude',
  autoStart: false,
  isActive: true,
  color: 2,
  panes: [PANE]
} as unknown as Workspace

const OXECODE_VIEW_AND_TOOLS_IDS = [
  'tool-editor',
  'tool-github',
  'tool-background',
  'toggle-split-layout',
  'balance-pane-layout',
  'split-vertical',
  'split-horizontal',
  'maximize-pane',
  'tool-android',
  'tool-http-calls'
] as const

const flat = (nodes: AppMenuNode[]): AppMenuNode[] =>
  nodes.flatMap((node) => (node.kind === 'submenu' ? [node, ...flat(node.children)] : [node]))

function menusFor(view: AppView, opts: { withWorkspace: boolean }) {
  const showCode = vi.fn()
  const toolEditor = vi.fn()
  const toolGithub = vi.fn()
  const toolHttpCalls = vi.fn()
  const splitActivePane = vi.fn()
  const toggleActivePaneMaximize = vi.fn()

  const actions = buildCodeCommands({
    applicationView: view,
    activeWorkspace: opts.withWorkspace ? WORKSPACE : null,
    activePane: opts.withWorkspace ? PANE : null,
    toolHandlers: {
      editor: toolEditor,
      github: toolGithub,
      'http-calls': toolHttpCalls
    },
    openTools: { editor: false, github: false, 'http-calls': false },
    showCode,
    openNewWorkspace: vi.fn(),
    splitActivePane,
    toggleActivePaneMaximize,
    openDesignSystem: vi.fn()
  })

  const menus = buildAppMenus({
    actions,
    applicationView: view,
    setApplicationView: vi.fn(),
    openSettings: vi.fn(),
    addThreadProject: vi.fn(),
    openCommandMenu: vi.fn(),
    version: '1.5.2'
  })

  const viewAndToolsNodes = (list: AppMenu[]): AppMenuNode[] =>
    list
      .filter((menu) => menu.id === 'view' || menu.id === 'tools')
      .flatMap((menu) => flat(menu.items))

  return {
    menus,
    nodes: viewAndToolsNodes(menus),
    spies: { showCode, toolEditor, toolGithub, toolHttpCalls, splitActivePane, toggleActivePaneMaximize }
  }
}

describe('OXE-12 · View and Tools menus parity between OxeChat and OxeQuery', () => {
  test('item do OxeCode leva ao OxeCode no OxeChat', () => {
    const chat = menusFor('thread', { withWorkspace: true })
    const query = menusFor('data', { withWorkspace: true })

    for (const [id, spyKey] of [
      ['tool-editor', 'toolEditor'],
      ['tool-http-calls', 'toolHttpCalls'],
      ['split-vertical', 'splitActivePane']
    ] as const) {
      const chatItem = chat.nodes.find((node) => node.id === id)
      const queryItem = query.nodes.find((node) => node.id === id)
      expect(chatItem?.kind, `chat ${id}`).toBe('item')
      expect(queryItem?.kind, `query ${id}`).toBe('item')
      if (chatItem?.kind !== 'item' || queryItem?.kind !== 'item') continue

      expect(chatItem.disabled, `chat ${id} enabled`).toBeFalsy()
      expect(chatItem.unavailable, `chat ${id} available`).toBeUndefined()
      expect(queryItem.disabled, `query ${id} enabled`).toBeFalsy()
      expect(queryItem.unavailable, `query ${id} available`).toBeUndefined()

      chatItem.onSelect()
      queryItem.onSelect()

      expect(chat.spies[spyKey]).toHaveBeenCalledTimes(1)
      expect(query.spies[spyKey]).toHaveBeenCalledTimes(1)
    }

    expect(chat.spies.showCode).toHaveBeenCalledTimes(3)
    expect(query.spies.showCode).toHaveBeenCalledTimes(3)
  })

  test('sem workspace, motivo nos dois modos', () => {
    for (const view of ['thread', 'data'] as const) {
      const { nodes, spies } = menusFor(view, { withWorkspace: false })
      for (const id of OXECODE_VIEW_AND_TOOLS_IDS) {
        const node = nodes.find((entry) => entry.id === id)
        expect(node, `${view}:${id}`).toBeDefined()
        expect(node?.kind, `${view}:${id}`).toBe('item')
        if (node?.kind !== 'item') continue
        expect(node.unavailable, `${view}:${id} has reason`).toBeTruthy()
        expect(node.disabled, `${view}:${id} is not plain disabled`).toBeFalsy()
        node.onSelect()
      }
      expect(spies.showCode).not.toHaveBeenCalled()
      expect(spies.toolEditor).not.toHaveBeenCalled()
      expect(spies.toolHttpCalls).not.toHaveBeenCalled()
      expect(spies.splitActivePane).not.toHaveBeenCalled()
    }
  })

  test('mesmo estado nos dois modos', () => {
    for (const withWorkspace of [true, false]) {
      const chat = menusFor('thread', { withWorkspace })
      const query = menusFor('data', { withWorkspace })

      const snapshot = (nodes: AppMenuNode[]) =>
        OXECODE_VIEW_AND_TOOLS_IDS.map((id) => {
          const node = nodes.find((entry) => entry.id === id)
          return node?.kind === 'item'
            ? { id, disabled: Boolean(node.disabled), unavailable: node.unavailable ?? null }
            : { id, missing: true }
        })

      expect(snapshot(chat.nodes), `withWorkspace=${withWorkspace}`).toEqual(snapshot(query.nodes))
    }
  })
})
