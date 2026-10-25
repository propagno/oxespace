import type { AppUpdatePreferences } from '../../../shared/types/updater'
import { SegmentedControl, Switch } from '../../ui'

function modeHint(preferences: AppUpdatePreferences): string {
  if (preferences.pinnedVersion !== null) return `Staying on v${preferences.pinnedVersion}: OXESpace does not check or download updates. Check for updates still tells you what is new.`
  if (preferences.mode === 'auto') return 'Checks every few hours, downloads in the background and installs when you restart.'
  if (preferences.mode === 'notify') return 'Checks every few hours and tells you when a version is out. Nothing downloads until you choose.'
  return 'Never checks on its own. Use Check for updates when you want to know.'
}

/** How OXESpace updates: the mode, a pinned version and the release channel. */
export function UpdatePreferences({ preferences, currentVersion, onChange }: {
  preferences: AppUpdatePreferences
  currentVersion: string
  onChange: (preferences: AppUpdatePreferences) => void
}) {
  const pinned = preferences.pinnedVersion !== null
  return (
    <div className="settings-update-preferences">
      <SegmentedControl label="How OXESpace updates" value={preferences.mode}
        options={[{ value: 'auto', label: 'Automatic' }, { value: 'notify', label: 'Notify me' }, { value: 'off', label: 'Off' }]}
        onChange={(mode) => onChange({ ...preferences, mode })} />
      <Switch checked={pinned} label={`Stay on v${pinned ? preferences.pinnedVersion : currentVersion}`} description="Keep this version until you turn this off."
        onChange={(checked) => onChange({ ...preferences, pinnedVersion: checked ? currentVersion : null })} />
      <Switch checked={preferences.channel === 'beta'} label="Receive beta versions"
        description={preferences.channel === 'beta'
          ? 'You get each beta as it comes out. Turning this off keeps your version until a newer stable one is out.'
          : 'Try upcoming features early. Betas are tested, but can change before the stable release.'}
        onChange={(checked) => onChange({ ...preferences, channel: checked ? 'beta' : 'stable' })} />
      <p className="settings-update-mode-hint" data-testid="app-update-mode-hint">{modeHint(preferences)}</p>
    </div>
  )
}
