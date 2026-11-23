// OXE-395: the terminal's automatic focus must not take the focus from a person who already moved on.
// CA-1 and CA-2 of the card. The xterm double is the one of tests/integration/TerminalView.test.tsx.
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TerminalView } from '../src/components/Terminal/TerminalView'
import { TERMINAL_PREFS_DEFAULTS } from '../src/store/terminal-prefs.store'

const terminalState = {
  onData: null as ((data: string) => void) | null,
  write: vi.fn(),
  focus: vi.fn(),
  dispose: vi.fn(),
  paste: vi.fn(),
  input: vi.fn(),
  refresh: vi.fn(),
  clear: vi.fn(),
  scrollLines: vi.fn(),
  scrollToBottom: vi.fn(),
  scrollToLine: vi.fn(),
  attachCustomKeyEventHandler: vi.fn(),
  attachCustomWheelEventHandler: vi.fn(),
  registerOscHandler: vi.fn(),
  getSelection: vi.fn(() => ''),
  clearSelection: vi.fn(),
  onSelectionChange: vi.fn(() => ({ dispose: vi.fn() }))
}

const searchState = {
  findNext: vi.fn(),
  findPrevious: vi.fn(),
  clearDecorations: vi.fn()
}

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(function () { return {
    cols: 120,
    rows: 32,
    options: {},
    loadAddon: vi.fn(),
    registerLinkProvider: vi.fn(() => ({ dispose: vi.fn() })),
    open: vi.fn(),
    write: terminalState.write,
    focus: terminalState.focus,
    dispose: terminalState.dispose,
    paste: terminalState.paste,
    input: terminalState.input,
    modes: { bracketedPasteMode: true, mouseTrackingMode: 'none' },
    refresh: terminalState.refresh,
    clear: terminalState.clear,
    scrollLines: terminalState.scrollLines,
    unicode: { activeVersion: '6' },
    scrollToBottom: terminalState.scrollToBottom,
    scrollToLine: terminalState.scrollToLine,
    attachCustomKeyEventHandler: terminalState.attachCustomKeyEventHandler,
    attachCustomWheelEventHandler: terminalState.attachCustomWheelEventHandler,
    parser: { registerOscHandler: terminalState.registerOscHandler },
    getSelection: terminalState.getSelection,
    clearSelection: terminalState.clearSelection,
    onSelectionChange: terminalState.onSelectionChange,
    buffer: {
      active: { type: 'normal', baseY: 0, viewportY: 0, cursorY: 0, length: 0, getLine: vi.fn(() => null) }
    },
    onData: vi.fn((handler: (data: string) => void) => {
      terminalState.onData = handler
      return { dispose: vi.fn() }
    })
  } })
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(function () { return {
    fit: vi.fn()
  } })
}))

vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: vi.fn()
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn()
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(function () { return {
    onContextLoss: vi.fn(),
    dispose: vi.fn()
  } })
}))

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: vi.fn().mockImplementation(function () { return {
    findNext: searchState.findNext,
    findPrevious: searchState.findPrevious,
    clearDecorations: searchState.clearDecorations,
    onDidChangeResults: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn()
  } })
}))

const transport = () => ({ onData: vi.fn(() => () => {}), onExit: vi.fn(() => () => {}), attach: vi.fn(async () => ({ running: false, seq: 0, prologue: '', replay: '', truncated: false, altScreen: false })), detach: vi.fn(async () => {}) })

describe('OXE-395 · the terminal takes focus only when the person has not moved on', () => {
  beforeEach(() => { terminalState.focus.mockClear(); document.body.innerHTML = '' })

  test('a late start does not take the focus the person moved', async () => {
    const other = document.createElement('input')
    other.setAttribute('aria-label', 'Search the editor')
    const io = transport()
    const view = render(<TerminalView paneId="p-late" transport={io} isRunning={false} themeId="one-dark" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)
    document.body.append(other)
    await waitFor(() => expect(io.attach).toHaveBeenCalled())
    // The person goes somewhere else while the shell is still starting (Ctrl+E, a click in another field) and types.
    fireEvent.pointerDown(other)
    other.focus()
    fireEvent.keyDown(other, { key: 'a' })
    terminalState.focus.mockClear()
    view.rerender(<TerminalView paneId="p-late" transport={io} isRunning themeId="one-dark" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(terminalState.focus, 'the terminal does not take the focus back').not.toHaveBeenCalled()
    expect(document.activeElement).toBe(other)
    view.unmount()
  })

  test('an untouched launch still focuses the terminal', async () => {
    const io = transport()
    const view = render(<TerminalView paneId="p-new" transport={io} isRunning={false} themeId="one-dark" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)
    await waitFor(() => expect(io.attach).toHaveBeenCalled())
    terminalState.focus.mockClear()
    view.rerender(<TerminalView paneId="p-new" transport={io} isRunning themeId="one-dark" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)
    await waitFor(() => expect(terminalState.focus, 'the terminal takes the focus when it starts').toHaveBeenCalled())
    view.unmount()
  })
})
