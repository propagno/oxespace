// Frozen acceptance test for 1.5.2 OxeCode A1 (OXE program oxespace-152-code, phase F1, CODE-8 from the 12/11 backlog).
// Written by the planner; the executor must not edit it.
// Contract: src/components/Terminal/terminalContextMenu.tsx exports
//   attachTerminalContextMenu(host: HTMLElement, terminal: TerminalLike): { dispose(): void }
//   TerminalLike = { hasSelection(): boolean; getSelection(): string; selectAll(): void; clear(): void; paste(text: string): void; focus(): void }
// (xterm's Terminal satisfies TerminalLike). TerminalView attaches it to the same host as the path links. A right click,
// Shift+F10 or the context-menu key (all a `contextmenu` event) that the path menu did not take (defaultPrevented) opens a
// menu named "Terminal" with Copy, Paste, Select all and Clear. Copy is disabled without a selection.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type TerminalLike = { hasSelection(): boolean; getSelection(): string; selectAll(): void; clear(): void; paste(text: string): void; focus(): void }
type Module = { attachTerminalContextMenu(host: HTMLElement, terminal: TerminalLike): { dispose(): void } }

function fakeTerminal(selection = ''): TerminalLike & { [K in keyof TerminalLike]: ReturnType<typeof vi.fn> } {
  return {
    hasSelection: vi.fn(() => selection.length > 0),
    getSelection: vi.fn(() => selection),
    selectAll: vi.fn(),
    clear: vi.fn(),
    paste: vi.fn(),
    focus: vi.fn()
  } as never
}

let host: HTMLElement
let clipboard: { readText: ReturnType<typeof vi.fn>; writeText: ReturnType<typeof vi.fn> }
let attached: { dispose(): void } | null = null

async function attach(terminal: TerminalLike): Promise<void> {
  const { attachTerminalContextMenu } = await import('../../../src/components/Terminal/terminalContextMenu') as unknown as Module
  attached = attachTerminalContextMenu(host, terminal)
}
const openMenu = async (): Promise<HTMLElement> => {
  await act(async () => { fireEvent.contextMenu(host, { clientX: 200, clientY: 150 }) })
  return await screen.findByRole('menu', { name: 'Terminal' })
}
const isDisabled = (item: HTMLElement): boolean => item.hasAttribute('disabled') || item.getAttribute('aria-disabled') === 'true'

beforeEach(async () => {
  await changeLanguage('en')
  host = document.createElement('div')
  host.className = 'terminal-host'
  document.body.append(host)
  clipboard = { readText: vi.fn(async () => 'npm test'), writeText: vi.fn(async () => true) }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, clipboard } })
})
afterEach(() => { attached?.dispose(); attached = null; cleanup(); host.remove(); vi.restoreAllMocks() })

describe('A1 · the terminal has a right-click menu (CODE-8)', () => {
  test('a contextmenu event opens a "Terminal" menu with Copy, Paste, Select all and Clear, in that order', async () => {
    await attach(fakeTerminal('hello'))
    await openMenu()
    expect(screen.getAllByRole('menuitem').map(item => item.textContent?.trim())).toEqual(['Copy', 'Paste', 'Select all', 'Clear'])
  })

  test('Copy writes the selection through the app clipboard and closes the menu', async () => {
    await attach(fakeTerminal('hello world'))
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy' }))
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('hello world'))
    expect(screen.queryByRole('menu', { name: 'Terminal' })).toBeNull()
  })

  test('without a selection Copy is disabled and does nothing', async () => {
    await attach(fakeTerminal(''))
    await openMenu()
    const copy = screen.getByRole('menuitem', { name: 'Copy' })
    expect(isDisabled(copy)).toBe(true)
    await userEvent.click(copy)
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })

  test('Paste sends the clipboard text to the terminal as a paste, and focus goes back to the terminal', async () => {
    const terminal = fakeTerminal('')
    await attach(terminal)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Paste' }))
    await waitFor(() => expect(terminal.paste).toHaveBeenCalledWith('npm test'))
    expect(terminal.focus).toHaveBeenCalled()
  })

  test('Select all and Clear act on the terminal', async () => {
    const terminal = fakeTerminal('x')
    await attach(terminal)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Select all' }))
    expect(terminal.selectAll).toHaveBeenCalledTimes(1)
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Clear' }))
    expect(terminal.clear).toHaveBeenCalledTimes(1)
  })

  test('Escape closes the menu and returns focus to the terminal', async () => {
    const terminal = fakeTerminal('x')
    await attach(terminal)
    await openMenu()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Terminal' })).toBeNull())
    expect(terminal.focus).toHaveBeenCalled()
  })

  test('a contextmenu the path menu already took (defaultPrevented) opens no terminal menu', async () => {
    await attach(fakeTerminal('x'))
    const pathMenu = (event: Event): void => { event.preventDefault() }
    host.addEventListener('contextmenu', pathMenu, true)
    await act(async () => { fireEvent.contextMenu(host, { clientX: 10, clientY: 10 }) })
    expect(screen.queryByRole('menu', { name: 'Terminal' })).toBeNull()
    host.removeEventListener('contextmenu', pathMenu, true)
  })

  test('dispose stops listening', async () => {
    await attach(fakeTerminal('x'))
    attached!.dispose()
    attached = null
    await act(async () => { fireEvent.contextMenu(host) })
    expect(screen.queryByRole('menu', { name: 'Terminal' })).toBeNull()
  })

  test('pt-BR names the items in Portuguese', async () => {
    await changeLanguage('pt-BR')
    await attach(fakeTerminal('x'))
    await act(async () => { fireEvent.contextMenu(host) })
    const menu = await screen.findByRole('menu')
    expect(menu.querySelectorAll('[role="menuitem"]')).toHaveLength(4)
    expect(screen.getByRole('menuitem', { name: 'Copiar' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Colar' })).toBeInTheDocument()
  })

  test('TerminalView attaches the menu to its host', () => {
    // rigor: source-assertion — TerminalView needs a live xterm and WebGL to mount; jsdom cannot run it, so the wiring
    // is read from the source and the behaviour is proven above against the attached module.
    const source = readFileSync(join(process.cwd(), 'src/components/Terminal/TerminalView.tsx'), 'utf8')
    expect(source).toMatch(/attachTerminalContextMenu\(\s*terminal\s*,?|attachTerminalContextMenu\(\s*hostRef\.current/)
  })
})
