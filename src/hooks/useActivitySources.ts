import { useEffect } from 'react'
import type { AppUpdateState } from '../../shared/types/updater'
import { i18n } from '../i18n'
import { useActivityStore } from '../store/activity.store'
import { useUpdaterStore } from '../store/updater.store'
import { useAgentNotifications } from './useAgentNotifications'
import { useMcpQuarantineActivity } from './useMcpQuarantineActivity'
import { useQuotaAlerts } from './useQuotaAlerts'
import { useThreadAttention } from './useThreadAttention'

/** What an app update state says to the activity center, or null when there is nothing new. */
export function updateActivity(app: Pick<AppUpdateState, 'status' | 'availableVersion'>): { version: string; title: string; detail: string } | null {
  const version = app.availableVersion
  if (!version) return null
  if (app.status === 'available') return { version, title: i18n.t('updates.activity.available', { version }), detail: i18n.t('updates.activity.availableDetail') }
  if (app.status === 'downloaded') return { version, title: i18n.t('updates.activity.ready', { version }), detail: i18n.t('updates.activity.readyDetail') }
  return null
}

function useUpdateActivity(): void {
  useEffect(() => {
    let last = ''
    const sync = (app: AppUpdateState): void => {
      const update = updateActivity(app)
      const signature = update ? `${app.status}:${update.version}` : ''
      if (!update || signature === last) return
      last = signature
      useActivityStore.getState().record({ source: 'update', id: update.version, kind: 'update', target: { type: 'update', version: update.version }, title: update.title, detail: update.detail })
    }
    sync(useUpdaterStore.getState().app)
    return useUpdaterStore.subscribe((state, previous) => { if (state.app !== previous.app) sync(state.app) })
  }, [])
}

/**
 * Every producer of the activity center in one place: agents in Code panes, conversations,
 * quota windows, app updates and quarantined MCP servers. Background jobs report from their store.
 */
export function useActivitySources(applicationView: import('../keyboard/keybindings').AppView): void {
  useAgentNotifications()
  useThreadAttention(applicationView)
  useQuotaAlerts()
  useUpdateActivity()
  useMcpQuarantineActivity()
}
