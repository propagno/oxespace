import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalFocusHost } from '../src/components/Keyboard/TerminalFocusHost'
import { KEYBINDINGS, chordsFor, dispatchKeybinding, isOverridden, isTerminalReservedChord } from '../src/keyboard/keybindings'
import { focusRegions, moveFocusRegion } from '../src/keyboard/focusRegions'
import { terminalKeyRoute, useTerminalFocusStore } from '../src/keyboard/terminalFocus'
import { useSettingsStore } from '../src/store/settings.store'

/** WCAG 2.1.2 No Keyboard Trap: F6 regions, the per-pane "Tab moves focus" mode and the way out said on entry. */
const key = (init: KeyboardEventInit & { key: string }, target?: Element): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  if (target) Object.defineProperty(event, 'target', { value: target })
  return event
}
const ctrlM = { key: 'm', code: 'KeyM', ctrlKey: true }

/** A terminal pane as the app renders it: the pane's host around xterm's focusable textarea. */
function terminal(paneId: string, parent: Element = document.body): HTMLTextAreaElement {
  const host = document.createElement('div')
  host.dataset.terminalPane = paneId
  host.innerHTML = '<div class="xterm"><textarea class="xterm-helper-textarea"></textarea></div>'
  parent.append(host)
  return host.querySelector('textarea')!
}

beforeEach(() => {
  // jsdom lays nothing out; every element counts as on screen.
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  useSettingsStore.setState({ keybindingOverrides: {} })
  useTerminalFocusStore.setState({ tabMovesFocus: {}, toggleKeyToShell: {} })
})

describe('reserved keys in a terminal', () => {
  it('F6 and Shift+F6 are fixed: listed, never rebound, never off, and reserved even in the Thread native CLI', () => {
    useSettingsStore.setState({ keybindingOverrides: { 'focus.nextRegion': [], 'focus.previousRegion': ['F8'] } })
    expect(chordsFor('focus.nextRegion')).toEqual(['F6'])
    expect(chordsFor('focus.previousRegion')).toEqual(['Shift+F6'])
    expect(isOverridden('focus.nextRegion')).toBe(false)
    for (const nativeCli of [false, true]) {
      expect(terminalKeyRoute(key({ key: 'F6' }), 'pane', nativeCli)).toBe('app')
      expect(terminalKeyRoute(key({ key: 'F6', shiftKey: true }), 'pane', nativeCli)).toBe('app')
      expect(terminalKeyRoute(key(ctrlM), 'pane', nativeCli)).toBe('app')
      expect(terminalKeyRoute(key({ key: 'r', ctrlKey: true }), 'pane', nativeCli)).toBe('shell')
    }
    // The native CLI keeps the rest of its keymap; a Code terminal gives the palette chord to the app.
    expect(isTerminalReservedChord(key({ key: 'k', ctrlKey: true }), true)).toBe(false)
    expect(terminalKeyRoute(key({ key: 'k', ctrlKey: true }), 'pane')).toBe('app')
    expect(KEYBINDINGS.filter(binding => 'fixed' in binding).map(binding => binding.id)).toEqual(['focus.nextRegion', 'focus.previousRegion'])
  })

  it('Tab moves focus only in the panes that turned it on', () => {
    useTerminalFocusStore.getState().setTabMovesFocus('a', true)
    expect(terminalKeyRoute(key({ key: 'Tab' }), 'a')).toBe('focus')
    expect(terminalKeyRoute(key({ key: 'Tab', shiftKey: true }), 'a')).toBe('focus')
    expect(terminalKeyRoute(key({ key: 'Tab' }), 'b')).toBe('shell')
    useTerminalFocusStore.getState().setTabMovesFocus('a', false)
    expect(terminalKeyRoute(key({ key: 'Tab' }), 'a')).toBe('shell')
  })
})

const announcer = (): Promise<HTMLElement> => screen.findByTestId('terminal-focus-announcer')

describe('the Tab focus toggle', () => {
  it('toggles the focused pane only, at once, and says so', async () => {
    render(<TerminalFocusHost />)
    const a = terminal('a'), b = terminal('b')
    expect(dispatchKeybinding(key(ctrlM, a))).toBe(true)
    // At once: a Tab pressed right after already moves focus.
    expect(terminalKeyRoute(key({ key: 'Tab' }), 'a')).toBe('focus')
    await waitFor(async () => expect(await announcer()).toHaveTextContent('Tab moves focus: on'))
    expect(await announcer()).toHaveAttribute('aria-live', 'polite')
    dispatchKeybinding(key(ctrlM, b))
    expect(useTerminalFocusStore.getState().tabMovesFocus).toEqual({ a: true, b: true })
    dispatchKeybinding(key(ctrlM, a))
    expect(useTerminalFocusStore.getState().tabMovesFocus).toEqual({ b: true })
    await waitFor(async () => expect(await announcer()).toHaveTextContent('Tab moves focus: off'))
    // Outside a terminal, Ctrl+M goes on as usual.
    expect(dispatchKeybinding(key(ctrlM, document.body))).toBe(false)
  })

  it('follows a rebound key, and the old Ctrl+M then reaches the shell', () => {
    render(<TerminalFocusHost />)
    const a = terminal('a')
    useSettingsStore.setState({ keybindingOverrides: { 'terminal.tabMovesFocus': ['Ctrl+Alt+T'] } })
    expect(dispatchKeybinding(key(ctrlM, a))).toBe(false)
    expect(terminalKeyRoute(key(ctrlM), 'a')).toBe('shell')
    expect(dispatchKeybinding(key({ key: 't', code: 'KeyT', ctrlKey: true, altKey: true }, a))).toBe(true)
    expect(useTerminalFocusStore.getState().tabMovesFocus).toEqual({ a: true })
    expect(terminalKeyRoute(key({ key: 't', code: 'KeyT', ctrlKey: true, altKey: true }), 'a')).toBe('app')
    // Turned off in Settings, nothing toggles and Ctrl+M stays the shell's.
    useSettingsStore.setState({ keybindingOverrides: { 'terminal.tabMovesFocus': [] } })
    expect(terminalKeyRoute(key(ctrlM), 'a')).toBe('shell')
  })

  it('a pane can send the toggle key to its shell instead', () => {
    render(<TerminalFocusHost />)
    const a = terminal('a'), b = terminal('b')
    useTerminalFocusStore.getState().setToggleKeyToShell('a', true)
    expect(terminalKeyRoute(key(ctrlM), 'a')).toBe('shell')
    expect(dispatchKeybinding(key(ctrlM, a))).toBe(false)
    expect(useTerminalFocusStore.getState().tabMovesFocus).toEqual({})
    expect(terminalKeyRoute(key(ctrlM), 'b')).toBe('app')
    dispatchKeybinding(key(ctrlM, b))
    expect(useTerminalFocusStore.getState().tabMovesFocus).toEqual({ b: true })
  })
})

describe('the way out, said on entry', () => {
  it('is announced once when focus enters a terminal, not on keystrokes or moves inside it', async () => {
    render(<><button type="button">before</button><TerminalFocusHost /></>)
    const textarea = terminal('a')
    screen.getByRole('button', { name: 'before' }).focus()
    act(() => { textarea.focus() })
    await waitFor(async () => expect(await announcer()).toHaveTextContent('Terminal. Press F6 to leave, or Ctrl+M to make Tab move focus.'))
    const region = await announcer()
    expect(region).toHaveAttribute('aria-live', 'polite')
    const first = region.firstElementChild
    fireEvent.keyDown(textarea, { key: 'a' })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    fireEvent.focusIn(textarea, { relatedTarget: textarea })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(region.firstElementChild).toBe(first)
    // Leaving and coming back says it again: a new entry.
    screen.getByRole('button', { name: 'before' }).focus()
    textarea.focus()
    await waitFor(() => expect(region.firstElementChild).not.toBe(first))
    expect(document.querySelectorAll('[data-testid="terminal-focus-announcer"]')).toHaveLength(1)
  })

  it('names only F6 when the toggle is off', async () => {
    useSettingsStore.setState({ keybindingOverrides: { 'terminal.tabMovesFocus': [] } })
    render(<TerminalFocusHost />)
    terminal('a').focus()
    await waitFor(async () => expect(await announcer()).toHaveTextContent(/^Terminal\. Press F6 to leave\.$/))
  })
})

describe('F6 regions', () => {
  function shell(): { sidebarButton: HTMLButtonElement; textarea: HTMLTextAreaElement; status: HTMLElement } {
    document.body.innerHTML = `<main class="app-shell">
      <header class="workbench-titlebar"><button type="button">Code</button></header>
      <aside class="sidebar"><input aria-label="Filter"></aside>
      <section class="workspace-surface">
        <div class="workspace-host workspace-host-hidden" aria-hidden="true"><div class="workspace-grid"><button type="button">hidden</button></div></div>
        <div class="workspace-host"><div class="workspace-grid" id="grid"><button type="button">pane menu</button></div></div>
        <footer class="app-statusbar"><span>status</span></footer>
      </section>
    </main>`
    return { sidebarButton: document.querySelector('aside input') as HTMLButtonElement, textarea: terminal('a', document.getElementById('grid')!), status: document.querySelector('.app-statusbar') as HTMLElement }
  }

  it('go title bar → sidebar → work area → status bar and round; hidden hosts are skipped', () => {
    const { status } = shell()
    expect(focusRegions().map(region => region.className)).toEqual(['workbench-titlebar', 'sidebar', 'workspace-grid', 'app-statusbar'])
    document.body.focus()
    moveFocusRegion(1)
    expect(document.activeElement).toHaveTextContent('Code')
    moveFocusRegion(1)
    expect(document.activeElement).toHaveAttribute('aria-label', 'Filter')
    moveFocusRegion(1)
    expect(document.activeElement).toHaveTextContent('pane menu')
    moveFocusRegion(1)
    // A region with nothing to focus takes focus itself.
    expect(document.activeElement).toBe(status)
    moveFocusRegion(1)
    expect(document.activeElement).toHaveTextContent('Code')
    moveFocusRegion(-1)
    expect(document.activeElement).toBe(status)
  })

  it('leave a terminal and come back to it', async () => {
    const { textarea, status } = shell()
    render(<TerminalFocusHost />, { container: document.body.appendChild(document.createElement('div')) })
    textarea.focus()
    expect(dispatchKeybinding(key({ key: 'F6' }, textarea))).toBe(true)
    await vi.waitFor(() => expect(document.activeElement).toBe(status))
    expect(dispatchKeybinding(key({ key: 'F6', shiftKey: true }, status))).toBe(true)
    await vi.waitFor(() => expect(document.activeElement).toBe(textarea))
    // Inside a dialog the key goes on to it.
    const dialog = document.body.appendChild(document.createElement('div'))
    dialog.setAttribute('role', 'dialog')
    expect(dispatchKeybinding(key({ key: 'F6' }, dialog))).toBe(false)
  })

  it('stay inside an open dialog or menu', () => {
    shell()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.innerHTML = '<button type="button">ok</button>'
    document.body.append(dialog)
    const ok = dialog.querySelector('button')!
    ok.focus()
    expect(moveFocusRegion(1)).toBe(false)
    expect(document.activeElement).toBe(ok)
  })
})
