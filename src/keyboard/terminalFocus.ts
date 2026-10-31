import { create } from 'zustand'
import { chordsFor, isTerminalReservedChord, matchesBinding } from './keybindings'

/**
 * The ways out of a terminal (WCAG 2.1.2 No Keyboard Trap). A shell needs Tab, so a focused terminal keeps it;
 * F6 and Shift+F6 leave for the next or previous region of the window, and the "Tab moves focus" toggle
 * (Ctrl+M by default, as in VS Code) makes Tab and Shift+Tab move focus out of that one terminal instead.
 *
 * Every choice is per pane and lasts for the session only, like VS Code's tab focus mode: a restart brings
 * every terminal back to sending Tab to the shell. A pane can also send the toggle's own key to the shell
 * (Ctrl+M is Enter, CR, in a terminal), for a TUI that binds it, or F6 and Shift+F6 to the program (mc, htop,
 * Far Manager, tig). The two never hold at once in a pane: one way out stays.
 */
interface TerminalFocusState {
  /** Panes whose Tab moves focus instead of reaching the shell. */
  tabMovesFocus: Record<string, true>
  /** Panes that send the toggle's key to the shell instead of toggling. */
  toggleKeyToShell: Record<string, true>
  /** Panes that send F6 and Shift+F6 to the program instead of moving between regions. */
  f6ToProgram: Record<string, true>
  /** Panes whose way out was already said this session. */
  entryHinted: Record<string, true>
  setTabMovesFocus: (paneId: string, on: boolean) => void
  setToggleKeyToShell: (paneId: string, on: boolean) => void
  setF6ToProgram: (paneId: string, on: boolean) => void
  markEntryHinted: (paneId: string) => void
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
  f6ToProgram: {},
  entryHinted: {},
  setTabMovesFocus: (paneId, on) => update(state => ({ tabMovesFocus: set(state.tabMovesFocus, paneId, on) })),
  // Sending the toggle key to the shell and F6 to the program would leave the pane no key out: one turns the other off.
  setToggleKeyToShell: (paneId, on) => update(state => ({ toggleKeyToShell: set(state.toggleKeyToShell, paneId, on),
    f6ToProgram: on ? set(state.f6ToProgram, paneId, false) : state.f6ToProgram })),
  // The way out changes, so the next entry into the pane says it again.
  setF6ToProgram: (paneId, on) => update(state => ({ f6ToProgram: set(state.f6ToProgram, paneId, on),
    toggleKeyToShell: on ? set(state.toggleKeyToShell, paneId, false) : state.toggleKeyToShell, entryHinted: set(state.entryHinted, paneId, false) })),
  markEntryHinted: paneId => update(state => ({ entryHinted: set(state.entryHinted, paneId, true) }))
}))

export const tabMovesFocus = (paneId: string): boolean => Boolean(useTerminalFocusStore.getState().tabMovesFocus[paneId])
export const toggleKeyToShell = (paneId: string): boolean => Boolean(useTerminalFocusStore.getState().toggleKeyToShell[paneId])

/**
 * True when F6 and Shift+F6 go to the program in this pane: its option is on and another way out still works,
 * the toggle (which has a key and takes it) or Tab already moving focus. Otherwise F6 stays the way out.
 */
export function f6ReachesProgram(paneId: string): boolean {
  const state = useTerminalFocusStore.getState()
  if (!state.f6ToProgram[paneId]) return false
  return Boolean(state.tabMovesFocus[paneId]) || (chordsFor('terminal.tabMovesFocus').length > 0 && !state.toggleKeyToShell[paneId])
}

/**
 * Where a key pressed in a focused terminal goes: `app` (a reserved shortcut: the window handles it), `focus`
 * (the browser moves focus, as for Tab in any other control) or `shell` (xterm sends it to the PTY).
 */
export function terminalKeyRoute(event: KeyboardEvent, paneId: string, nativeCli = false): 'app' | 'focus' | 'shell' {
  if (matchesBinding(event, 'focus.nextRegion') || matchesBinding(event, 'focus.previousRegion')) return f6ReachesProgram(paneId) ? 'shell' : 'app'
  // The binding in effect, so a rebound toggle frees Ctrl+M for the shell.
  if (matchesBinding(event, 'terminal.tabMovesFocus')) return toggleKeyToShell(paneId) ? 'shell' : 'app'
  if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey && tabMovesFocus(paneId)) return 'focus'
  return isTerminalReservedChord(event, nativeCli) ? 'app' : 'shell'
}

/** The pane of the terminal an element sits in, or null outside a terminal. */
export function terminalPaneOf(element: Element | null): string | null {
  return element?.closest<HTMLElement>('[data-terminal-pane]')?.dataset.terminalPane ?? null
}
