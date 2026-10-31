import { i18n } from '../i18n'
import { shortcutLabel } from './keybindings'
import { tabMovesFocus, useTerminalFocusStore } from './terminalFocus'

export { moveFocusRegion } from './focusRegions'

/**
 * The parts of the ways out of a terminal that wait for first use, so the startup bundle carries only the keys
 * (src/components/Keyboard/TerminalFocusHost.tsx): the polite live region, what it says, and the region walk.
 */
let region: HTMLElement | null = null

/** Says `message` in the polite live region, even when it is the same text as last time. */
export function announceFocus(message: string): void {
  if (!region?.isConnected) {
    region = document.createElement('div')
    region.className = 'sr-only'
    region.setAttribute('role', 'status')
    region.setAttribute('aria-live', 'polite')
    region.dataset.testid = 'terminal-focus-announcer'
    document.body.append(region)
  }
  // A new node each time: a screen reader says a replaced text again, not an unchanged one.
  const text = document.createElement('span')
  text.textContent = message
  region.replaceChildren(text)
}

/** What a screen reader hears when focus enters a terminal: how to leave it. */
export function terminalEntryHint(): string {
  const toggle = shortcutLabel('terminal.tabMovesFocus')
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
