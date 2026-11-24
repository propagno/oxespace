import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { AppUpdatePreferences } from '../../../shared/types/updater'
import { SegmentedControl, SettingRow, Switch } from '../../ui'

function modeHint(preferences: AppUpdatePreferences, t: TFunction<'settings'>): string {
  if (preferences.pinnedVersion !== null) return t('updates.preferences.hint.pinned', { version: preferences.pinnedVersion })
  return t(`updates.preferences.hint.${preferences.mode}`)
}

/** How OXESpace updates: the mode, a pinned version and the release channel. */
export function UpdatePreferences({ preferences, currentVersion, onChange }: {
  preferences: AppUpdatePreferences
  currentVersion: string
  onChange: (preferences: AppUpdatePreferences) => void
}) {
  const { t } = useTranslation('settings')
  const pinned = preferences.pinnedVersion !== null
  const stayLabel = t('updates.preferences.stay', { version: pinned ? preferences.pinnedVersion : currentVersion })
  const betaLabel = t('updates.preferences.beta')
  return (
    <div className="settings-update-preferences">
      <SegmentedControl label={t('updates.preferences.label')} value={preferences.mode}
        options={(['auto', 'notify', 'off'] as const).map(value => ({ value, label: t(`updates.preferences.${value}`) }))}
        onChange={(mode) => onChange({ ...preferences, mode })} />
      <SettingRow
        label={stayLabel}
        description={t('updates.preferences.stayHint')}
        control={<Switch checked={pinned} ariaLabel={stayLabel}
          onChange={(checked) => onChange({ ...preferences, pinnedVersion: checked ? currentVersion : null })} />}
      />
      <SettingRow
        label={betaLabel}
        description={preferences.channel === 'beta' ? t('updates.preferences.betaOn') : t('updates.preferences.betaOff')}
        control={<Switch checked={preferences.channel === 'beta'} ariaLabel={betaLabel}
          onChange={(checked) => onChange({ ...preferences, channel: checked ? 'beta' : 'stable' })} />}
      />
      <p className="settings-update-mode-hint" data-testid="app-update-mode-hint">{modeHint(preferences, t)}</p>
    </div>
  )
}
