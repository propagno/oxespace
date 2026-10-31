import { create } from 'zustand'
import { isTerminalReservedChord, matchesBinding } from './keybindings'

/**
 * The ways out of a terminal (WCAG 2.1.2 No Keyboard Trap). A shell needs Tab, so a focused terminal keeps it;
 * F6 and Shift+F6 always leave for the next or previous region of the window, and the "Tab moves focus" toggle
 * (Ctrl+M by default, as in VS Code) makes Tab and Shift+Tab move focus out of that one terminal instead.
 *
 * Both choices are per pane and last for the session only, like VS Code's tab focus mode: a restart brings
 * every terminal back to sending Tab to the shell. A pane can also send the toggle's own key to the shell
 * (Ctrl+M is Enter, CR, in a terminal), for a TUI that binds it.
 */
interface TerminalFocusState {
  /** Panes whose Tab moves focus instead of reaching the shell. */
  tabMovesFocus: Record<string, true>
  /** Panes that send the toggle's key to the shell instead of toggling. */
  toggleKeyToShell: Record<string, true>
  setTabMovesFocus: (paneId: string, on: boolean) => void
  setToggleKeyToShell: (paneId: string, on: boolean) => void
}

const set = (record: Record<string, true>, paneId: string, on: boolean): Record<string, true> => {
  const next = { ...record }
  if (on) next[paneId] = true
  else delete next[paneId]
  return next
}

export const useTerminalFocusStore = create<TerminalFocusState>(update => ({
  tabMovesFocus: {},
  toggleKeyToShell: {},
  setTabMovesFocus: (paneId, on) => update(state => ({ tabMovesFocus: set(state.tabMovesFocus, paneId, on) })),
  setToggleKeyToShell: (paneId, on) => update(state => ({ toggleKeyToShell: set(state.toggleKeyToShell, paneId, on) }))
}))

export const tabMovesFocus = (paneId: string): boolean => Boolean(useTerminalFocusStore.getState().tabMovesFocus[paneId])
export const toggleKeyToShell = (paneId: string): boolean => Boolean(useTerminalFocusStore.getState().toggleKeyToShell[paneId])

/**
 * Where a key pressed in a focused terminal goes: `app` (a reserved shortcut: the window handles it), `focus`
 * (the browser moves focus, as for Tab in any other control) or `shell` (xterm sends it to the PTY).
 */
export function terminalKeyRoute(event: KeyboardEvent, paneId: string, nativeCli = false): 'app' | 'focus' | 'shell' {
  if (matchesBinding(event, 'focus.nextRegion') || matchesBinding(event, 'focus.previousRegion')) return 'app'
  // The binding in effect, so a rebound toggle frees Ctrl+M for the shell.
  if (matchesBinding(event, 'terminal.tabMovesFocus')) return toggleKeyToShell(paneId) ? 'shell' : 'app'
  if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey && tabMovesFocus(paneId)) return 'focus'
  return isTerminalReservedChord(event, nativeCli) ? 'app' : 'shell'
}

/** The pane of the terminal an element sits in, or null outside a terminal. */
export function terminalPaneOf(element: Element | null): string | null {
  return element?.closest<HTMLElement>('[data-terminal-pane]')?.dataset.terminalPane ?? null
}
