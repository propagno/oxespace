import { ArrowRightLeft, Check, CornerDownLeft } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { setTabMovesFocus } from '../../keyboard/terminalFocusActions'
import { shortcutLabel } from '../../keyboard/keybindings'
import { useTerminalFocusStore } from '../../keyboard/terminalFocus'

/**
 * The pane menu's side of "Tab moves focus" (src/keyboard/terminalFocus.ts): turn it on or off for this pane
 * without the shortcut, and, while the shortcut has a key, send that key to the shell instead (Ctrl+M is Enter,
 * CR, in a terminal; a TUI may bind it).
 */
export function TerminalFocusMenuItems({ paneId, onDone }: { paneId: string; onDone: () => void }): ReactElement {
  const { t } = useTranslation()
  const tabOn = useTerminalFocusStore(state => Boolean(state.tabMovesFocus[paneId]))
  const keyToShell = useTerminalFocusStore(state => Boolean(state.toggleKeyToShell[paneId]))
  const key = shortcutLabel('terminal.tabMovesFocus')
  const store = useTerminalFocusStore.getState()
  return <>
    <button type="button" role="menuitemcheckbox" aria-checked={tabOn} className="pane-actions-popover-item" data-testid="pane-menu-tab-moves-focus"
      onClick={event => { event.stopPropagation(); onDone(); setTabMovesFocus(paneId, !tabOn) }}>
      <ArrowRightLeft size={14} aria-hidden="true" />{t('keys.terminalFocus.menu')}{tabOn ? <Check size={14} aria-hidden="true" /> : null}
    </button>
    {key ? <button type="button" role="menuitemcheckbox" aria-checked={keyToShell} className="pane-actions-popover-item" data-testid="pane-menu-toggle-key-to-shell"
      onClick={event => { event.stopPropagation(); onDone(); store.setToggleKeyToShell(paneId, !keyToShell) }}>
      <CornerDownLeft size={14} aria-hidden="true" />{t('keys.terminalFocus.toggleKeyToShell', { key })}{keyToShell ? <Check size={14} aria-hidden="true" /> : null}
    </button> : null}
  </>
}
