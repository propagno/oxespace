import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingRow, SettingsSection, Switch } from '../../ui'
import { useSettingsStore } from '../../store/settings.store'

/** Settings › Notifications: play the sound when an agent finishes (OXE-130). Off by factory default. */
export function FinishSoundSetting(): ReactElement {
  const { t } = useTranslation('settings')
  const finishSound = useSettingsStore(s => s.finishSound)
  const setFinishSound = useSettingsStore(s => s.setFinishSound)
  return <SettingsSection title={t('notifications.sound.title')}>
    <SettingRow label={t('notifications.sound.label')} description={t('notifications.sound.hint')}
      control={<Switch checked={finishSound} onChange={setFinishSound} ariaLabel={t('notifications.sound.label')} />} />
  </SettingsSection>
}
