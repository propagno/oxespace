import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalFocusMenuItems } from '../src/components/Grid/TerminalFocusMenuItems'
import { ShortcutGuide } from '../src/components/Keyboard/ShortcutGuide'
import { TerminalFocusHost } from '../src/components/Keyboard/TerminalFocusHost'
import { changeLanguage } from '../src/i18n'
import { KEYBINDINGS, chordsFor, dispatchKeybinding, isOverridden, isTerminalReservedChord } from '../src/keyboard/keybindings'
import { focusRegions, moveFocusRegion } from '../src/keyboard/focusRegions'
import { f6ReachesProgram, terminalKeyRoute, useTerminalFocusStore } from '../src/keyboard/terminalFocus'
import { terminalEntryHint } from '../src/keyboard/terminalFocusActions'
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
afterEach(async () => {
  vi.restoreAllMocks()
  // Unmount first (the host owns the live region), and let a pending announcement land before the page is cleared.
  cleanup()
  await new Promise(resolve => setTimeout(resolve, 10))
  document.body.innerHTML = ''
  useSettingsStore.setState({ keybindingOverrides: {} })
  useTerminalFocusStore.setState({ tabMovesFocus: {}, toggleKeyToShell: {}, f6ToProgram: {}, entryHinted: {} })
  await changeLanguage('en')
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
    // Leaving and coming back is not a first entry: the hint is said once per pane per session.
    screen.getByRole('button', { name: 'before' }).focus()
    textarea.focus()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(region.firstElementChild).toBe(first)
    expect(document.querySelectorAll('[data-testid="terminal-focus-announcer"]')).toHaveLength(1)
  })

  it('is said on the first entry into each pane, once per pane (T4)', async () => {
    render(<><button type="button">before</button><TerminalFocusHost /></>)
    const before = screen.getByRole('button', { name: 'before' })
    const a = terminal('a'), b = terminal('b')
    const said: string[] = []
    const region = await announcer()
    new MutationObserver(() => { if (region.textContent) said.push(region.textContent) }).observe(region, { childList: true, subtree: true })
    for (const target of [a, b, a, b, a]) {
      before.focus()
      act(() => { target.focus() })
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    expect(said).toHaveLength(2)
    expect(useTerminalFocusStore.getState().entryHinted).toEqual({ a: true, b: true })
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

  it('the mode switch is a stop of its own, and the sidebar is entered at its filter, never at its width divider', () => {
    document.body.innerHTML = `<main class="app-shell">
      <header class="workbench-titlebar"><button type="button">File</button><nav data-focus-region="modes" aria-label="Application view"><button type="button" data-app-mode="code">OxeCode</button></nav></header>
      <aside class="sidebar"><div role="separator" tabindex="0" aria-label="Sidebar width"></div><input aria-label="Filter"><button type="button">conversation</button></aside>
    </main>`
    document.body.focus()
    moveFocusRegion(1)
    expect(document.activeElement).toHaveTextContent('File')
    moveFocusRegion(1)
    expect(document.activeElement).toHaveTextContent('OxeCode')
    moveFocusRegion(1)
    expect(document.activeElement).toHaveAttribute('aria-label', 'Filter')
    moveFocusRegion(-1)
    expect(document.activeElement).toHaveTextContent('OxeCode')
    moveFocusRegion(-1)
    // The title bar is entered at its own controls, not at the mode switch inside it.
    expect(document.activeElement).toHaveTextContent('File')
  })

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
    expect(status).toHaveAttribute('tabindex', '-1')
    moveFocusRegion(1)
    expect(document.activeElement).toHaveTextContent('Code')
    // T5: the tabindex that let the status bar take focus goes when focus leaves it.
    expect(status).not.toHaveAttribute('tabindex')
    moveFocusRegion(-1)
    expect(document.activeElement).toBe(status)
    moveFocusRegion(-1)
    expect(document.querySelectorAll('[tabindex="-1"]')).toHaveLength(0)
  })

  it('leave no tabindex behind, and keep a tabindex the page set itself (T5)', () => {
    const { status } = shell()
    status.tabIndex = 0
    status.focus()
    moveFocusRegion(1)
    expect(status).toHaveAttribute('tabindex', '0')
    for (let step = 0; step < 8; step++) moveFocusRegion(1)
    expect(document.querySelectorAll('.workbench-titlebar[tabindex], .sidebar[tabindex], .workspace-grid[tabindex]')).toHaveLength(0)
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

describe('the live region (T2)', () => {
  it('is in the page, empty, from the first render, before anything is said', async () => {
    render(<TerminalFocusHost />)
    const region = screen.getByTestId('terminal-focus-announcer')
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toBeEmptyDOMElement()
    // The first words go into that same node: no second region is made.
    act(() => { terminal('a').focus() })
    await waitFor(() => expect(region).toHaveTextContent('Terminal. Press F6 to leave'))
    expect(document.querySelectorAll('[data-testid="terminal-focus-announcer"]')).toHaveLength(1)
    expect(screen.getByTestId('terminal-focus-announcer')).toBe(region)
  })
})

describe('the toggle is said every time (T3)', () => {
  const cases = [['en', 'Tab moves focus: on', 'Tab moves focus: off'], ['pt-BR', 'Tab move o foco: ligado', 'Tab move o foco: desligado']] as const
  for (const [language, on, off] of cases) {
    it(`from the keyboard and from the pane menu, in ${language}`, async () => {
      await changeLanguage(language)
      render(<TerminalFocusHost />)
      const region = screen.getByTestId('terminal-focus-announcer')
      const a = terminal('a')
      const said: string[] = []
      new MutationObserver(() => { if (region.textContent) said.push(region.textContent) }).observe(region, { childList: true, subtree: true })
      for (const expected of [on, off, on]) {
        dispatchKeybinding(key(ctrlM, a))
        await waitFor(() => expect(region).toHaveTextContent(expected))
      }
      const onDone = vi.fn()
      render(<div role="menu"><TerminalFocusMenuItems paneId="a" onDone={onDone} /></div>)
      await userEvent.click(screen.getByTestId('pane-menu-tab-moves-focus'))
      await waitFor(() => expect(region).toHaveTextContent(off))
      await userEvent.click(screen.getByTestId('pane-menu-tab-moves-focus'))
      await waitFor(() => expect(region).toHaveTextContent(on))
      expect(said).toEqual([on, off, on, off, on])
      expect(onDone).toHaveBeenCalledTimes(2)
    })
  }
})

describe('"Send F6 to the program", per pane (T1)', () => {
  it('sends F6 and Shift+F6 to the program only in that pane, and Ctrl+M still gets out there', () => {
    render(<TerminalFocusHost />)
    const a = terminal('a'), b = terminal('b')
    useTerminalFocusStore.getState().setF6ToProgram('a', true)
    for (const f6 of [{ key: 'F6' }, { key: 'F6', shiftKey: true }]) {
      expect(terminalKeyRoute(key(f6), 'a')).toBe('shell')
      expect(dispatchKeybinding(key(f6, a))).toBe(false)
      expect(terminalKeyRoute(key(f6), 'b')).toBe('app')
    }
    // Ctrl+M still toggles in that pane, and Tab then leaves it.
    expect(terminalKeyRoute(key(ctrlM), 'a')).toBe('app')
    expect(dispatchKeybinding(key(ctrlM, a))).toBe(true)
    expect(terminalKeyRoute(key({ key: 'Tab' }), 'a')).toBe('focus')
    // Another pane keeps F6 as the way out.
    expect(dispatchKeybinding(key({ key: 'F6' }, b))).toBe(true)
  })

  it('never leaves a pane without a key out', () => {
    const store = useTerminalFocusStore.getState()
    store.setF6ToProgram('a', true)
    // Sending Ctrl+M to the shell as well turns F6 back into the way out.
    store.setToggleKeyToShell('a', true)
    expect(useTerminalFocusStore.getState()).toMatchObject({ f6ToProgram: {}, toggleKeyToShell: { a: true } })
    expect(terminalKeyRoute(key({ key: 'F6' }), 'a')).toBe('app')
    useTerminalFocusStore.getState().setF6ToProgram('a', true)
    expect(useTerminalFocusStore.getState()).toMatchObject({ f6ToProgram: { a: true }, toggleKeyToShell: {} })
    // With the toggle turned off in Settings, F6 stays the way out whatever the option says.
    useSettingsStore.setState({ keybindingOverrides: { 'terminal.tabMovesFocus': [] } })
    expect(f6ReachesProgram('a')).toBe(false)
    expect(terminalKeyRoute(key({ key: 'F6' }), 'a')).toBe('app')
  })

  it('the hint of that pane names Ctrl+M, not F6, and is said again after the option changes', async () => {
    useTerminalFocusStore.getState().setF6ToProgram('a', true)
    expect(terminalEntryHint('a')).toBe('Terminal. F6 goes to the program here. Press Ctrl+M to make Tab move focus.')
    expect(terminalEntryHint('b')).toBe('Terminal. Press F6 to leave, or Ctrl+M to make Tab move focus.')
    await changeLanguage('pt-BR')
    expect(terminalEntryHint('a')).toBe('Terminal. Aqui o F6 vai para o programa. Pressione Ctrl+M para que o Tab mova o foco.')
    await changeLanguage('en')
    render(<TerminalFocusHost />)
    const region = screen.getByTestId('terminal-focus-announcer')
    const a = terminal('a')
    act(() => { a.focus() })
    await waitFor(() => expect(region).toHaveTextContent('F6 goes to the program here'))
    expect(region).not.toHaveTextContent('F6 to leave')
    useTerminalFocusStore.getState().setF6ToProgram('a', false)
    act(() => { a.blur(); a.focus() })
    await waitFor(() => expect(region).toHaveTextContent('Terminal. Press F6 to leave'))
  })

  it('is a checkbox in the pane menu, next to "Send Ctrl+M to the shell"', async () => {
    const onDone = vi.fn()
    render(<div role="menu"><TerminalFocusMenuItems paneId="a" onDone={onDone} /></div>)
    expect(screen.getAllByRole('menuitemcheckbox').map(item => item.textContent)).toEqual(['Tab moves focus', 'Send Ctrl+M to the shell', 'Send F6 to the program'])
    const f6 = screen.getByRole('menuitemcheckbox', { name: 'Send F6 to the program' })
    expect(f6).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(f6)
    expect(useTerminalFocusStore.getState().f6ToProgram).toEqual({ a: true })
    expect(screen.getByRole('menuitemcheckbox', { name: 'Send F6 to the program' })).toHaveAttribute('aria-checked', 'true')
    expect(onDone).toHaveBeenCalledOnce()
  })

  it('is documented in the shortcut guide, with the toggle key', () => {
    render(<ShortcutGuide view="code" onClose={() => undefined} />)
    const note = within(screen.getByTestId('shortcut-guide')).getByTestId('shortcut-guide-f6-note')
    expect(note).toHaveTextContent('“Send F6 to the program”')
    expect(note).toHaveTextContent('Ctrl+M still makes Tab move focus')
  })
})
