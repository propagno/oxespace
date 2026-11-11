import { Search } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { IS_MAC } from '../../keyboard/chords'
import { shortcutLabel } from '../../keyboard/keybindings'
import { Button } from '../../ui/Button'
import { Kbd } from '../../ui/Field'
import styles from './CommandBar.module.css'

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
      icon={<Search size={13} aria-hidden="true" />}
      aria-keyshortcuts={keyShortcuts}
      onClick={onOpen}
    >
      <span className={styles.triggerLabel}>{t('commandBar.trigger')}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </Button>
  )
}
