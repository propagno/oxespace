import { useEffect, type ReactElement } from 'react'
import { useKeybindings } from '../../keyboard/keybindings'
import { f6ReachesProgram, tabMovesFocus, terminalPaneOf, toggleKeyToShell, useTerminalFocusStore } from '../../keyboard/terminalFocus'

// What the live region says and the region walk load on first use (src/keyboard/terminalFocusActions.ts).
const actions = () => import('../../keyboard/terminalFocusActions')
const targetOf = (event: Event): Element | null => event.target instanceof Element ? event.target : null

/** F6 / Shift+F6: false inside a modal dialog, an open menu, or a pane that sends F6 to its program. */
function moveRegion(direction: 1 | -1, event: KeyboardEvent): boolean {
  const from = targetOf(event)
  if (from?.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) return false
  const paneId = terminalPaneOf(from)
  if (paneId && from?.closest('.xterm') && f6ReachesProgram(paneId)) return false
  void actions().then(module => module.moveFocusRegion(direction, from))
  return true
}

/**
 * The ways out of a terminal (WCAG 2.1.2): F6 / Shift+F6 between the window's regions, the "Tab moves focus"
 * toggle of the focused pane, and the polite announcement of the way out the first time focus enters each pane's
 * terminal in the session (never on keystrokes: focus stays in xterm's textarea while typing).
 *
 * The live region is in the page from boot, empty, so a screen reader already watches it when the first words
 * come (an element added with its text is often not read).
 */
export function TerminalFocusHost(): ReactElement {
  useEffect(() => {
    const onFocusIn = (event: FocusEvent): void => {
      const terminal = targetOf(event)?.closest('.xterm')
      const from = event.relatedTarget instanceof Element ? event.relatedTarget : null
      if (!terminal || (from && terminal.contains(from))) return
      const paneId = terminalPaneOf(terminal)
      if (paneId) {
        if (useTerminalFocusStore.getState().entryHinted[paneId]) return
        useTerminalFocusStore.getState().markEntryHinted(paneId)
      }
      void actions().then(module => module.announceFocus(module.terminalEntryHint(paneId)))
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])
  useKeybindings({
    'focus.nextRegion': event => moveRegion(1, event),
    'focus.previousRegion': event => moveRegion(-1, event),
    'terminal.tabMovesFocus': event => {
      const paneId = terminalPaneOf(targetOf(event))
      // A pane that sends the key to the shell keeps it; outside a terminal the key goes on as usual.
      if (!paneId || toggleKeyToShell(paneId)) return false
      // The mode changes at once, so a Tab pressed right after already moves focus; the words follow.
      const on = !tabMovesFocus(paneId)
      useTerminalFocusStore.getState().setTabMovesFocus(paneId, on)
      void actions().then(module => module.announceTabMode(on))
    }
  })
  return <div className="sr-only" role="status" aria-live="polite" data-testid="terminal-focus-announcer" />
}
