import type { AppUpdateState } from '../../../shared/types/updater'
import { i18n } from '../../i18n'

export interface UpdateChipView {
  label: string
  actions: string[]
}

export function updateChipView(
  state: AppUpdateState,
  context: { criticalHold: boolean }
): UpdateChipView | null {
  if (context.criticalHold) return null
  switch (state.status) {
    case 'available':
      return {
        label: i18n.t('updates.chip.available', {
          ns: 'common',
          version: state.availableVersion ?? ''
        }),
        actions: []
      }
    case 'downloading':
      return {
        label: i18n.t('updates.chip.downloading', {
          ns: 'common',
          version: state.availableVersion ?? '',
          percent: Math.round(state.progress ?? 0)
        }),
        actions: []
      }
    case 'downloaded':
      return {
        label: i18n.t('updates.chip.downloaded', { ns: 'common' }),
        actions: [
          i18n.t('updates.chip.restartNow', { ns: 'common' }),
          i18n.t('updates.chip.later', { ns: 'common' })
        ]
      }
    case 'error':
      return {
        label: i18n.t('updates.chip.error', { ns: 'common' }),
        actions: [i18n.t('updates.chip.openReleases', { ns: 'common' })]
      }
    default:
      return null
  }
}
