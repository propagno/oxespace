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

export interface AppUpdateState {
  status: AppUpdateStatus
  currentVersion: string
  availableVersion: string | null
  /** Download progress 0–100 when status === 'downloading'. */
  progress: number | null
  error: string | null
  lastCheckedAt: number | null
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
