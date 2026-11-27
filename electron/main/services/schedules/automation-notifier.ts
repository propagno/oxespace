import { notificationsEnabled } from '../notification-preference'

export type AutomationNotificationKind = 'needs_review' | 'waiting_approval' | 'failed' | 'timed_out'

export interface AutomationNotificationPayload {
  kind: AutomationNotificationKind
  scheduleId: string
  runId: string
  title: string
  body: string
}

export type AutomationNotifier = (payload: AutomationNotificationPayload) => boolean | void

/**
 * Emits a native OS notification for automation lifecycle transitions (`needs_review`, `waiting_approval`, `failed`,
 * `timed_out`) when desktop notifications are enabled and Electron's `Notification` API is supported.
 * Safely degrades to a no-op in headless/test environments without crashing.
 */
export function createNativeAutomationNotifier(onClick?: (payload: AutomationNotificationPayload) => void): AutomationNotifier {
  return (payload) => {
    if (!notificationsEnabled()) return false
    try {
      // Dynamic require keeps this module importable in pure Node/Vitest environments.
      const electron = require('electron') as { Notification?: { isSupported?: () => boolean; new (opts: { title: string; body: string }): { on: (e: string, cb: () => void) => void; show: () => void } } }
      const NativeNotification = electron?.Notification
      if (!NativeNotification || typeof NativeNotification.isSupported !== 'function' || !NativeNotification.isSupported()) {
        return false
      }
      const notification = new NativeNotification({ title: payload.title, body: payload.body })
      if (onClick) {
        notification.on('click', () => onClick(payload))
      }
      notification.show()
      return true
    } catch {
      return false
    }
  }
}
