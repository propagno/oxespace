import { ArrowRightLeft, Check, CornerDownLeft, Keyboard } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../ui'
import styles from './PaneMenu.module.css'
import { setTabMovesFocus } from '../../keyboard/terminalFocusActions'
import { shortcutLabel } from '../../keyboard/keybindings'
import { useTerminalFocusStore } from '../../keyboard/terminalFocus'

/**
 * The pane menu's side of "Tab moves focus" (src/keyboard/terminalFocus.ts): turn it on or off for this pane
 * without the shortcut, and, while the shortcut has a key, send that key to the shell instead (Ctrl+M is Enter,
 * CR, in a terminal; a TUI may bind it), or F6 and Shift+F6 to the program (mc, htop, Far Manager, tig use F6).
 * Only one of those two holds at once, so the pane keeps a way out (src/keyboard/terminalFocus.ts).
 */
export function TerminalFocusMenuItems({ paneId, onDone }: { paneId: string; onDone: () => void }): ReactElement {
  const { t } = useTranslation()
  const tabOn = useTerminalFocusStore(state => Boolean(state.tabMovesFocus[paneId]))
  const keyToShell = useTerminalFocusStore(state => Boolean(state.toggleKeyToShell[paneId]))
  const f6ToProgram = useTerminalFocusStore(state => Boolean(state.f6ToProgram[paneId]))
  const key = shortcutLabel('terminal.tabMovesFocus')
  const store = useTerminalFocusStore.getState()
  return <>
    <Button variant="ghost" role="menuitemcheckbox" aria-checked={tabOn} className={styles.item} data-testid="pane-menu-tab-moves-focus"
      onClick={event => { event.stopPropagation(); onDone(); setTabMovesFocus(paneId, !tabOn) }}>
      <ArrowRightLeft size={14} aria-hidden="true" />{t('keys.terminalFocus.menu')}{tabOn ? <Check size={14} aria-hidden="true" /> : null}
    </Button>
    {key ? <Button variant="ghost" role="menuitemcheckbox" aria-checked={keyToShell} className={styles.item} data-testid="pane-menu-toggle-key-to-shell"
      onClick={event => { event.stopPropagation(); onDone(); store.setToggleKeyToShell(paneId, !keyToShell) }}>
      <CornerDownLeft size={14} aria-hidden="true" />{t('keys.terminalFocus.toggleKeyToShell', { key })}{keyToShell ? <Check size={14} aria-hidden="true" /> : null}
    </Button> : null}
    {key ? <Button variant="ghost" role="menuitemcheckbox" aria-checked={f6ToProgram} className={styles.item} data-testid="pane-menu-f6-to-program"
      onClick={event => { event.stopPropagation(); onDone(); store.setF6ToProgram(paneId, !f6ToProgram) }}>
      <Keyboard size={14} aria-hidden="true" />{t('keys.terminalFocus.f6ToProgram')}{f6ToProgram ? <Check size={14} aria-hidden="true" /> : null}
    </Button> : null}
  </>
}
