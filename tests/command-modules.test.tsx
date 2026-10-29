import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ThreadSnapshot } from '../shared/types/thread'
import { buildCodeCommands } from '../src/commands/code.commands'
import { buildThreadCommands, THREAD_RUN_COMMAND_EVENT } from '../src/commands/thread.commands'
import { useCommandSource } from '../src/commands/useCommandSource'
import '../src/commands/settings.commands'
import { useUIStore } from '../src/store/ui.store'
import { useContributedCommands } from '../src/utils/commandRegistry'

const noop = (): void => undefined
const codeContext = { applicationView: 'code' as const, activeWorkspace: null, activePane: null, hasTeamTarget: false, toolHandlers: {},
  openNewWorkspace: noop, splitActivePane: noop, toggleActivePaneMaximize: noop, toggleActivePaneVoice: noop, openDesignSystem: noop }
const threadContext = { snapshot: null, projects: [], showThread: vi.fn(), newThread: vi.fn(), newThreadIn: vi.fn(), addProject: vi.fn(), openAccounts: vi.fn() }

describe('command modules', () => {
  it('Code commands carry registry shortcuts and disable what needs a workspace', () => {
    const commands = buildCodeCommands(codeContext)
    const sidebar = commands.find(command => command.id === 'toggle-sidebar')
    expect(sidebar?.shortcut).toBe('sidebar.toggle')
    expect(sidebar?.disabled).toBeFalsy()
    expect(commands.find(command => command.id === 'tool-editor')).toMatchObject({ shortcut: 'code.files', disabled: true })
    expect(commands.find(command => command.id === 'split-vertical')?.disabled).toBe(true)
  })

  it('Code panel commands run from Thread show Code and open the panel, never close one left open', () => {
    const workspace = { id: 'w1', panes: [] } as unknown as NonNullable<Parameters<typeof buildCodeCommands>[0]['activeWorkspace']>
    const showCode = vi.fn(), files = vi.fn(), mcp = vi.fn()
    const fromThread = (open: boolean) => buildCodeCommands({ ...codeContext, applicationView: 'thread', activeWorkspace: workspace, showCode, toolHandlers: { editor: files, mcp }, openTools: { editor: open } })
    fromThread(false).find(command => command.id === 'tool-editor')!.run()
    expect(showCode).toHaveBeenCalledTimes(1)
    expect(files).toHaveBeenCalledTimes(1)
    fromThread(true).find(command => command.id === 'tool-editor')!.run()
    expect(showCode).toHaveBeenCalledTimes(2)
    expect(files).toHaveBeenCalledTimes(1)
    // MCP servers open over any view.
    fromThread(false).find(command => command.id === 'tool-mcp')!.run()
    expect(mcp).toHaveBeenCalled()
    expect(showCode).toHaveBeenCalledTimes(2)
    // Ctrl+, opens application Settings; Workspace settings has no shortcut of its own.
    expect(fromThread(false).find(command => command.id === 'workspace-settings')?.shortcut).toBeUndefined()
    expect(fromThread(false).some(command => command.id === 'find-in-files')).toBe(false)
  })

  it('Thread commands switch to Thread and send composer commands to the active conversation', async () => {
    const snapshot = { thread: { id: 't1' }, turns: [] } as unknown as ThreadSnapshot
    const commands = buildThreadCommands({ ...threadContext, snapshot, projects: [{ projectId: 'p1', displayName: 'repo', identityLabel: 'C:/repo', hidden: false, contexts: [] }] })
    expect(commands.map(command => command.id)).toEqual(expect.arrayContaining(['thread.new', 'thread.project.p1', 'thread.spending', 'thread.undo-last-turn', 'thread.accounts']))
    const received = vi.fn()
    window.addEventListener(THREAD_RUN_COMMAND_EVENT, received)
    commands.find(command => command.id === 'thread.spending')!.run()
    await new Promise(resolve => requestAnimationFrame(resolve))
    expect(threadContext.showThread).toHaveBeenCalled()
    expect((received.mock.calls[0][0] as CustomEvent).detail).toEqual({ text: '/spending' })
    window.removeEventListener(THREAD_RUN_COMMAND_EVENT, received)
    expect(buildThreadCommands(threadContext).find(command => command.id === 'thread.spending')?.disabled).toBe(true)
  })

  it('Settings pages, Keyboard and Policy included, open from the palette', () => {
    const { result } = renderHook(() => useContributedCommands())
    const ids = result.current.map(action => action.id)
    expect(ids).toEqual(expect.arrayContaining(['settings.keyboard', 'settings.policy', 'settings.diagnostics', 'help.shortcuts']))
    result.current.find(action => action.id === 'settings.keyboard')!.run()
    expect(useUIStore.getState()).toMatchObject({ isSettingsOpen: true, settingsInitialPage: 'keyboard' })
    useUIStore.setState({ isSettingsOpen: false, settingsInitialPage: undefined })
  })

  it('registers state-built commands only when what they show changes, and runs the latest handler', () => {
    const palette = renderHook(() => useContributedCommands())
    const first = vi.fn(), second = vi.fn()
    const { rerender, unmount } = renderHook(({ run, disabled }) => useCommandSource('test', [{ id: 'test.cmd', label: 'Test', category: 'Test', disabled, run }]),
      { initialProps: { run: first, disabled: false } })
    const registered = palette.result.current.find(action => action.id === 'test.cmd')
    rerender({ run: second, disabled: false })
    // Same signature: the palette keeps the same entry, which now calls the new handler.
    expect(palette.result.current.find(action => action.id === 'test.cmd')).toBe(registered)
    act(() => registered!.run())
    expect(second).toHaveBeenCalled()
    expect(first).not.toHaveBeenCalled()
    rerender({ run: second, disabled: true })
    expect(palette.result.current.find(action => action.id === 'test.cmd')?.disabled).toBe(true)
    unmount()
    expect(palette.result.current.some(action => action.id === 'test.cmd')).toBe(false)
  })
})
