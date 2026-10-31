import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useTerminalFocusStore } from '../../keyboard/terminalFocus'
import styles from './TabFocusBadge.module.css'

/** The visible sign that Tab moves focus in this terminal instead of reaching the shell. */
export function TabFocusBadge({ paneId }: { paneId: string }): ReactElement | null {
  const on = useTerminalFocusStore(state => Boolean(state.tabMovesFocus[paneId]))
  const { t } = useTranslation()
  if (!on) return null
  return <span className={styles.badge} data-testid="tab-focus-badge">{t('keys.terminalFocus.badge')}</span>
}
