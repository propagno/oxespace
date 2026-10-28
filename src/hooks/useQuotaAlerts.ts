import { useEffect } from 'react'
import { useActivityStore } from '../store/activity.store'
import { useSettingsStore } from '../store/settings.store'
import { nextQuotaState, quotaNotificationText, type QuotaTrack } from '../utils/quotaThresholds'

/** Prefix on the notification pane id so a click is recognised as "not a pane". */
export const QUOTA_NOTIFICATION_PANE_PREFIX = 'quota:'

const FIRST_CHECK_MS = 20_000
const POLL_MS = 5 * 60_000
const PROVIDERS = ['claude', 'codex'] as const

/**
 * Watches the subscription windows already cached by the credits service and
 * raises one notification per threshold crossed. Silent when the bridge is
 * absent, the provider is not installed or the numbers are unavailable.
 */
export function useQuotaAlerts(): void {
  useEffect(() => {
    const api = window.oxe?.agentCredits
    if (!api?.get) return
    const tracks = new Map<string, QuotaTrack>()
    let disposed = false

    const check = async (): Promise<void> => {
      for (const provider of PROVIDERS) {
        let snapshot
        try { snapshot = await api.get({ provider, force: false }) } catch { continue }
        if (disposed || !snapshot?.available) continue
        for (const usage of snapshot.windows) {
          const key = `${provider}:${usage.kind}`
          const decision = nextQuotaState(tracks.get(key), usage.usedPct, usage.resetsAtMs)
          tracks.set(key, decision.track)
          if (decision.crossed === null) continue
          const text = quotaNotificationText(provider, usage.kind, decision.crossed, usage.resetsAtMs)
          useActivityStore.getState().record({ source: 'quota', id: key, kind: 'quota', target: { type: 'quota', provider }, title: text.title, detail: text.body })
          if (!useSettingsStore.getState().notificationsEnabled) continue
          void window.oxe?.notifications?.notify({ ...text, paneId: `${QUOTA_NOTIFICATION_PANE_PREFIX}${provider}`, workspaceId: '' }).catch(() => undefined)
        }
      }
    }

    const first = setTimeout(() => void check(), FIRST_CHECK_MS)
    const interval = setInterval(() => void check(), POLL_MS)
    return () => { disposed = true; clearTimeout(first); clearInterval(interval) }
  }, [])
}
