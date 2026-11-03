/**
 * What a notification click is routed by, kept apart from the hooks that raise the notifications: App reads these on
 * every click, and the hooks load after the first frame (ActivitySources).
 */

/** Prefix that routes a notification click to a thread instead of a terminal pane. */
export const THREAD_NOTIFICATION_PANE_PREFIX = 'thread:'

/** Prefix on the notification pane id so a click is recognised as "not a pane". */
export const QUOTA_NOTIFICATION_PANE_PREFIX = 'quota:'
