/** App auto-update (electron-updater → GitHub Releases). */
export type AppUpdateStatus =
  | 'disabled'      // unpackaged / dev
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

/**
 * How the app updates itself. `auto` downloads in the background and installs on quit; `notify` checks and
 * says a version is out, and downloads only when asked; `off` checks only when asked. A pinned version is
 * kept: no periodic checks and no downloads, though a manual check still says what is new.
 */
export type AppUpdateMode = 'auto' | 'notify' | 'off'
/** `beta` also offers pre-releases (`X.Y.Z-beta.N`). Leaving beta never downgrades: the app waits for a newer stable. */
export type AppUpdateChannel = 'stable' | 'beta'
export interface AppUpdatePreferences { mode: AppUpdateMode; pinnedVersion: string | null; channel: AppUpdateChannel }

export interface AppUpdateState {
  status: AppUpdateStatus
  /** Manual for source/dev and Linux package-manager installs. */
  installMode?: 'automatic' | 'manual'
  currentVersion: string
  availableVersion: string | null
  /** Download progress 0–100 when status === 'downloading'. */
  progress: number | null
  error: string | null
  lastCheckedAt: number | null
  preferences?: AppUpdatePreferences
}

/** RTK sidecar (userData/bin) version tracking. */
export interface RtkUpdateState {
  installed: boolean
  /** Local version from rtk.version (or null if legacy install without file). */
  version: string | null
  latestVersion: string | null
  updateAvailable: boolean
  binDir: string | null
  error: string | null
  checking: boolean
  updating: boolean
  lastCheckedAt: number | null
}
