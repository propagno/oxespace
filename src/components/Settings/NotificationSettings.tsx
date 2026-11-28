import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { SegmentedControl, SettingRow, SettingsSection, Switch } from '../../ui'
import { NOTIFICATION_TRIGGER_MODES, useSettingsStore, type NotificationTriggerMode } from '../../store/settings.store'

/** Settings › Notifications: separate granular controls for approval prompts vs turn completion (OXE-479). */
export function NotificationModesSetting(): ReactElement {
  const { t } = useTranslation('settings')
  const approvalNotifyMode = useSettingsStore(s => s.approvalNotifyMode)
  const setApprovalNotifyMode = useSettingsStore(s => s.setApprovalNotifyMode)
  const completionNotifyMode = useSettingsStore(s => s.completionNotifyMode)
  const setCompletionNotifyMode = useSettingsStore(s => s.setCompletionNotifyMode)
  const options = NOTIFICATION_TRIGGER_MODES.map(mode => ({
    value: mode,
    label: t(`notifications.modes.options.${mode}`)
  }))
  return <SettingsSection title={t('notifications.modes.title')} description={t('notifications.modes.description')}>
    <SettingRow
      label={t('notifications.modes.approvalLabel')}
      description={t('notifications.modes.approvalHint')}
      control={
        <SegmentedControl<NotificationTriggerMode>
          label={t('notifications.modes.approvalLabel')}
          value={approvalNotifyMode}
          onChange={setApprovalNotifyMode}
          options={options}
        />
      }
    />
    <SettingRow
      label={t('notifications.modes.completionLabel')}
      description={t('notifications.modes.completionHint')}
      control={
        <SegmentedControl<NotificationTriggerMode>
          label={t('notifications.modes.completionLabel')}
          value={completionNotifyMode}
          onChange={setCompletionNotifyMode}
          options={options}
        />
      }
    />
  </SettingsSection>
}

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
