import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppView } from '../../keyboard/keybindings'
import { Button } from '../../ui'

/**
 * The Team button of the title bar. The Team belongs to a project, so without one the button is off and its
 * tooltip says where to find one.
 */
export function TeamButton({ view, enabled, onOpen }: { view: AppView; enabled: boolean; onOpen: () => void }): ReactElement {
  const { t } = useTranslation()
  const reason = view === 'code' ? t('team.button.needsWorkspace') : view === 'thread' ? t('team.button.needsProject') : t('team.button.otherViews')
  return <Button size="sm" disabled={!enabled} title={enabled ? t('team.button.title') : reason} onClick={onOpen}>{t('team.button.label')}</Button>
}
