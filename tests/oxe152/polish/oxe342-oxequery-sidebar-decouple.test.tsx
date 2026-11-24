// OXE-342 ([HML][P1]): OxeQuery's Ctrl+B sidebar toggle is decoupled from OxeCode's sidebarCollapsed.
// Pressing Ctrl+B (or running the toggle-sidebar command / clicking the sidebar button) in OxeQuery
// collapses or expands only OxeQuery's sidebar without mutating OxeCode's or OxeChat's sidebar state (and vice versa).
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { buildCodeCommands } from '../../../src/commands/code.commands'
import { isDataView } from '../../../src/components/Navigation/ModeViews'
import { OxeQuerySidebar } from '../../../src/components/OxeQuery/OxeQuerySidebar'
import { useOxeQueryStore } from '../../../src/components/OxeQuery/oxequery.store'
import { setKeyboardView, useKeybindings, type AppView } from '../../../src/keyboard/keybindings'
import { useUIStore } from '../../../src/store/ui.store'

function SidebarShortcutHarness({ view }: { view: AppView }) {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const toggleOxeQuerySidebar = useUIStore((s) => s.toggleOxeQuerySidebar)
  setKeyboardView(view)
  useKeybindings({
    'sidebar.toggle': () => {
      if (isDataView(view)) toggleOxeQuerySidebar()
      else toggleSidebar(view === 'thread' ? 'thread' : 'code')
    }
  })
  return view === 'data' ? <OxeQuerySidebar /> : <div data-testid="other-view" />
}

const noop = (): void => undefined
const baseCodeContext = {
  applicationView: 'code' as AppView,
  activeWorkspace: null,
  activePane: null,
  toolHandlers: {},
  openNewWorkspace: noop,
  splitActivePane: noop,
  toggleActivePaneMaximize: noop,
  openDesignSystem: noop
}

beforeEach(() => {
  localStorage.clear()
  useUIStore.setState({
    isSidebarCollapsed: false,
    collapsedSidebars: { code: false, thread: false },
    oxequerySidebarCollapsed: false
  })
  vi.spyOn(useOxeQueryStore.getState(), 'refreshConnections').mockResolvedValue(undefined)
  useOxeQueryStore.setState({
    connections: [],
    activeTab: 'home',
    preferencesOpen: false
  })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  setKeyboardView('code')
  vi.restoreAllMocks()
})

describe('OXE-342 · OxeQuery Ctrl+B sidebar toggle decoupled from OxeCode', () => {
  test('Ctrl+B in OxeQuery toggles only OxeQuery sidebar and leaves OxeCode and OxeChat untouched', () => {
    const { container } = render(<SidebarShortcutHarness view="data" />)
    const aside = container.querySelector('aside.oq-sidebar')!
    expect(aside).not.toHaveClass('thread-navigation-collapsed')

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })

    expect(useUIStore.getState().oxequerySidebarCollapsed).toBe(true)
    expect(useUIStore.getState().collapsedSidebars).toEqual({ code: false, thread: false })
    expect(useUIStore.getState().isSidebarCollapsed).toBe(false)
    expect(localStorage.getItem('oxe.sidebar.collapsed.data')).toBe('true')
    expect(localStorage.getItem('oxe.sidebar.collapsed.code')).toBeNull()
    expect(container.querySelector('aside.oq-sidebar')).toHaveClass('thread-navigation-collapsed')

    // Press Ctrl+B again to expand OxeQuery back
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })
    expect(useUIStore.getState().oxequerySidebarCollapsed).toBe(false)
    expect(useUIStore.getState().collapsedSidebars).toEqual({ code: false, thread: false })
    expect(useUIStore.getState().isSidebarCollapsed).toBe(false)
  })

  test('Ctrl+B in OxeCode toggles only OxeCode sidebar and leaves OxeQuery untouched', () => {
    render(<SidebarShortcutHarness view="code" />)

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true })

    expect(useUIStore.getState().collapsedSidebars).toEqual({ code: true, thread: false })
    expect(useUIStore.getState().isSidebarCollapsed).toBe(true)
    expect(useUIStore.getState().oxequerySidebarCollapsed).toBe(false)
    expect(localStorage.getItem('oxe.sidebar.collapsed.data')).toBeNull()
  })

  test('clicking the collapse and expand controls in OxeQuerySidebar does not affect OxeCode', () => {
    const { container } = render(<OxeQuerySidebar />)
    const aside = container.querySelector('aside.oq-sidebar')!
    const collapseBtn = within(aside).getByRole('button', { name: /collapse sidebar/i })

    fireEvent.click(collapseBtn)

    expect(useUIStore.getState().oxequerySidebarCollapsed).toBe(true)
    expect(useUIStore.getState().collapsedSidebars).toEqual({ code: false, thread: false })
    expect(useUIStore.getState().isSidebarCollapsed).toBe(false)

    const expandBtn = within(container.querySelector('aside.oq-sidebar')!).getByRole('button', { name: /expand sidebar/i })
    fireEvent.click(expandBtn)

    expect(useUIStore.getState().oxequerySidebarCollapsed).toBe(false)
    expect(useUIStore.getState().collapsedSidebars).toEqual({ code: false, thread: false })
    expect(useUIStore.getState().isSidebarCollapsed).toBe(false)
  })

  test('toggle-sidebar command toggles only the active view sidebar', () => {
    act(() => {
      buildCodeCommands({ ...baseCodeContext, applicationView: 'data' })
        .find((c) => c.id === 'toggle-sidebar')!
        .run()
    })
    expect(useUIStore.getState().oxequerySidebarCollapsed).toBe(true)
    expect(useUIStore.getState().collapsedSidebars).toEqual({ code: false, thread: false })

    act(() => {
      buildCodeCommands({ ...baseCodeContext, applicationView: 'code' })
        .find((c) => c.id === 'toggle-sidebar')!
        .run()
    })
    expect(useUIStore.getState().collapsedSidebars).toEqual({ code: true, thread: false })
    expect(useUIStore.getState().oxequerySidebarCollapsed).toBe(true)
  })
})
