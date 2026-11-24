import { afterEach, describe, expect, test } from 'vitest'
import { takeHeldFocus } from '../../src/lib/paletteFocus'
import { useUIStore } from '../../src/store/ui.store'

/**
 * OXE-397 (CA-2: broken by #1044, OXE-348): the palette mounts only while open, so keys typed right after its shortcut
 * reached the terminal that still had focus and ran in its shell. Opening it now takes focus away at once and keeps the
 * element to give it back on close.
 */
describe('OXE-397 · opening the palette takes focus away from the terminal at once', () => {
  afterEach(() => { useUIStore.setState({ isCommandMenuOpen: false }); document.body.innerHTML = '' })

  test('keys typed before the palette mounts do not reach the terminal, and focus goes back to it on close', () => {
    const terminal = document.createElement('textarea')
    terminal.className = 'xterm-helper-textarea'
    document.body.append(terminal)
    terminal.focus()
    expect(document.activeElement).toBe(terminal)

    useUIStore.getState().openCommandMenu()
    expect(document.activeElement, 'the terminal no longer receives keys').not.toBe(terminal)
    expect(takeHeldFocus(), 'the palette returns focus to the terminal').toBe(terminal)
  })

  test('asking again while the palette is open does not take focus from its own input', () => {
    useUIStore.setState({ isCommandMenuOpen: true })
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    useUIStore.getState().openCommandMenu()
    expect(document.activeElement).toBe(input)
  })
})
