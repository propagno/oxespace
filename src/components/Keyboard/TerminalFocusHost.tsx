import { useEffect } from 'react'
import { useKeybindings } from '../../keyboard/keybindings'
import { tabMovesFocus, terminalPaneOf, toggleKeyToShell, useTerminalFocusStore } from '../../keyboard/terminalFocus'

// The live region, its text and the region walk load on first use (src/keyboard/terminalFocusActions.ts).
const actions = () => import('../../keyboard/terminalFocusActions')
const targetOf = (event: Event): Element | null => event.target instanceof Element ? event.target : null

/** F6 / Shift+F6: false inside a modal dialog or an open menu, which keep focus until they close (Escape). */
function moveRegion(direction: 1 | -1, event: KeyboardEvent): boolean {
  const from = targetOf(event)
  if (from?.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) return false
  void actions().then(module => module.moveFocusRegion(direction, from))
  return true
}

/**
 * The ways out of a terminal (WCAG 2.1.2): F6 / Shift+F6 between the window's regions, the "Tab moves focus"
 * toggle of the focused pane, and the polite announcement of the way out when focus enters a terminal, once per
 * entry and never on keystrokes (focus stays in xterm's textarea while typing).
 */
export function TerminalFocusHost(): null {
  useEffect(() => {
    const onFocusIn = (event: FocusEvent): void => {
      const terminal = targetOf(event)?.closest('.xterm')
      const from = event.relatedTarget instanceof Element ? event.relatedTarget : null
      if (terminal && !(from && terminal.contains(from))) void actions().then(module => module.announceFocus(module.terminalEntryHint()))
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
  return null
}
