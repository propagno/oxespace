/**
 * OXE-368 · Settings › Desktop notifications, as the main process knows it. The window sends the preference at start and
 * on each change (`notifications:set-enabled`); every road that shows a desktop notification from main reads it here.
 * On until the window says otherwise, which is the setting's default.
 */
let enabled = true

export function notificationsEnabled(): boolean {
  return enabled
}

export function setNotificationsEnabled(value: boolean): void {
  enabled = value
}
