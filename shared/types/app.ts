import type { MainMessage } from '../messages'

/**
 * `app:connectivity`: whether the computer has a network route, as the system reports it. It says nothing about a
 * provider being reachable; the window uses it for the offline state, the main process for not retrying in vain.
 */
export interface AppConnectivity {
  state: 'online' | 'offline' | 'unknown'
  /** When the main process last read it (epoch ms). */
  checkedAt: number
  /** Why it is not online, as a code the window translates (C3). */
  reason?: MainMessage
}

/** `app:about`: what the About screen and a problem report show. No paths, accounts or machine names. */
export interface AppAbout {
  name: 'OXESpace'
  version: string
  /** `dev` for an unpackaged run. */
  channel: 'stable' | 'beta' | 'dev'
  /** Short commit the build came from, when the build recorded it. */
  commit: string | null
  /** ISO date of the build, when the build recorded it. */
  builtAt: string | null
  versions: { electron: string; chrome: string; node: string; v8: string }
  platform: NodeJS.Platform
  arch: string
  /** Operating system release, e.g. `10.0.26200`. */
  osRelease: string
  license: 'MIT'
  repositoryUrl: string
}

/** The `app` API members of these contracts, next to the update ones in `ipc.ts`. */
export interface AppInfoApi {
  /** Whether the computer has a network route right now. */
  connectivity?(): Promise<AppConnectivity>
  /** Sent when connectivity changes. */
  onConnectivity?(listener: (state: AppConnectivity) => void): () => void
  /** Version, build and runtime facts for the About screen. */
  about?(): Promise<AppAbout>
}

/**
 * The picture a desktop notification shows, by meaning. The main process maps it to an image it ships; the window
 * never passes a path or URL.
 */
export const NOTIFICATION_ICONS = ['attention', 'done', 'failed', 'info'] as const
export type NotificationIcon = typeof NOTIFICATION_ICONS[number]

export function isNotificationIcon(value: unknown): value is NotificationIcon {
  return typeof value === 'string' && (NOTIFICATION_ICONS as readonly string[]).includes(value)
}
