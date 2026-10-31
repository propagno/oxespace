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
  /** Sent when the window is about to close or the app to quit (F26): answer with `answerClose`. */
  onCloseRequested?(listener: (request: CloseRequest) => void): () => void
  /** The window's answer to a `CloseRequest`. */
  answerClose?(input: CloseAnswerInput): Promise<void>
}

/** Why main asks: the main window is closing, or the whole app is quitting. */
export const CLOSE_REASONS = ['close', 'quit'] as const
export type CloseReason = typeof CLOSE_REASONS[number]

/**
 * `app:close-requested` (F26, nothing lost on close): main holds a close or a quit and asks the window first. The
 * first answer must arrive within 3 s or main goes ahead anyway; never sent on OS shutdown, session end or an
 * update install.
 */
export interface CloseRequest {
  requestId: string
  /** A `close` that is still pending becomes `quit` when a quit arrives meanwhile; no second request is sent. */
  reason: CloseReason
}

/**
 * `hold`: an unsaved-work dialog is open; main waits, with no deadline, for a later `proceed` or `cancel`.
 * `proceed`: close or quit now. `cancel`: stay open.
 */
export const CLOSE_ANSWERS = ['hold', 'proceed', 'cancel'] as const
export type CloseAnswer = typeof CLOSE_ANSWERS[number]

/** `app:close-answer`: exactly these two keys. An unknown or stale `requestId` is ignored. */
export interface CloseAnswerInput {
  /** At most 100 characters. */
  requestId: string
  answer: CloseAnswer
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
