import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { IS_MAC } from '../../keyboard/chords'
import { shortcutLabel } from '../../keyboard/keybindings'
import { Button } from '../../ui/Button'
import { Kbd } from '../../ui/Field'
import styles from './CommandBarTrigger.module.css'

export interface CommandBarTriggerProps {
  onOpen: () => void
}

export function CommandBarTrigger({ onOpen }: CommandBarTriggerProps): ReactElement {
  const { t } = useTranslation()
  const shortcut = shortcutLabel('commandBar.open')
  const keyShortcuts = IS_MAC ? 'Meta+K' : 'Control+K'

  return (
    <Button
      size="sm"
      variant="secondary"
      className={styles.trigger}
      aria-keyshortcuts={keyShortcuts}
      onClick={onOpen}
    >
      <span className={styles.prompt} aria-hidden="true">›</span>
      <span className={styles.label}>{t('commandBar.trigger')}</span>
      <span className={styles.hint} aria-hidden="true">@ /</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </Button>
  )
}
