import { i18n } from '../i18n'
import { shortcutLabel } from './keybindings'
import { f6ReachesProgram, tabMovesFocus, useTerminalFocusStore } from './terminalFocus'

export { moveFocusRegion } from './focusRegions'

/**
 * The parts of the ways out of a terminal that wait for first use, so the startup bundle carries only the keys
 * and the empty live region (src/components/Keyboard/TerminalFocusHost.tsx): what it says, and the region walk.
 */
const ANNOUNCER_ID = 'terminal-focus-announcer'

/** The polite live region mounted at boot; made here only where nothing mounted it (a test, say). */
function announcer(): HTMLElement {
  const mounted = document.querySelector<HTMLElement>(`[data-testid="${ANNOUNCER_ID}"]`)
  if (mounted) return mounted
  const region = document.createElement('div')
  region.className = 'sr-only'
  region.setAttribute('role', 'status')
  region.setAttribute('aria-live', 'polite')
  region.dataset.testid = ANNOUNCER_ID
  document.body.append(region)
  return region
}

/** Says `message` in the polite live region, even when it is the same text as last time. */
export function announceFocus(message: string): void {
  // A new node each time: a screen reader says a replaced text again, not an unchanged one.
  const text = document.createElement('span')
  text.textContent = message
  announcer().replaceChildren(text)
}

/** What a screen reader hears when focus first enters a pane's terminal: how to leave it. */
export function terminalEntryHint(paneId?: string | null): string {
  const toggle = shortcutLabel('terminal.tabMovesFocus')
  // F6 goes to the program in this pane, so the toggle is the way out to name.
  if (toggle && paneId && f6ReachesProgram(paneId)) return i18n.t('keys.terminalFocus.hintF6ToProgram', { toggle })
  return toggle ? i18n.t('keys.terminalFocus.hint', { toggle }) : i18n.t('keys.terminalFocus.hintF6')
}

/** Says whether Tab now moves focus. */
export function announceTabMode(on: boolean): void {
  announceFocus(i18n.t(on ? 'keys.terminalFocus.on' : 'keys.terminalFocus.off'))
}

/** Turns "Tab moves focus" on or off for a pane (flips it without `on`) and says the new state. */
export function setTabMovesFocus(paneId: string, on = !tabMovesFocus(paneId)): void {
  useTerminalFocusStore.getState().setTabMovesFocus(paneId, on)
  announceTabMode(on)
}
