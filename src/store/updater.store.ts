import { create } from 'zustand'
import type { AppUpdateState, RtkUpdateState } from '../../shared/types/updater'

interface UpdaterStore {
  app: AppUpdateState
  rtk: RtkUpdateState
  dismissedVersion: string | null
  bootstrap: () => void
  checkAppUpdates: () => Promise<void>
  quitAndInstall: () => Promise<void>
  checkRtk: () => Promise<void>
  updateRtk: () => Promise<void>
  dismissBanner: () => void
}

// Default matches unpackaged/dev until bootstrap loads the real main-process state.
// Packaged builds flip to idle/checking via getUpdateState shortly after open.
const APP_DEFAULT: AppUpdateState = {
  status: 'disabled',
  currentVersion: 'dev',
  availableVersion: null,
  progress: null,
  error: null,
  lastCheckedAt: null
}

const RTK_DEFAULT: RtkUpdateState = {
  installed: false,
  version: null,
  latestVersion: null,
  updateAvailable: false,
  binDir: null,
  error: null,
  checking: false,
  updating: false,
  lastCheckedAt: null
}

let unsubApp: (() => void) | null = null

export const useUpdaterStore = create<UpdaterStore>((set, get) => ({
  app: APP_DEFAULT,
  rtk: RTK_DEFAULT,
  dismissedVersion: null,

  bootstrap: () => {
    const api = typeof window !== 'undefined' ? window.oxe : undefined
    if (!api?.app?.getUpdateState) {
      set({
        app: {
          ...APP_DEFAULT,
          status: 'disabled',
          error: 'Updates only run in installed builds',
          lastCheckedAt: Date.now()
        }
      })
      return
    }

    void api.app.getUpdateState().then((app) => set({ app })).catch(() => undefined)
    void api.rtk?.getStatus().then((rtk) => set({ rtk })).catch(() => undefined)
    // Background RTK version check (does not download unless ensureRtk path does).
    void api.rtk?.checkForUpdate().then((rtk) => set({ rtk })).catch(() => undefined)

    unsubApp?.()
    unsubApp = api.app.onUpdateState((app) => set({ app }))
  },

  checkAppUpdates: async () => {
    const api = window.oxe?.app
    if (!api?.checkForUpdates) return
    try {
      const app = await api.checkForUpdates()
      set({ app, dismissedVersion: null })
    } catch (err) {
      set({
        app: {
          ...get().app,
          status: 'error',
          error: err instanceof Error ? err.message : String(err)
        }
      })
    }
  },

  quitAndInstall: async () => {
    const api = window.oxe?.app
    if (!api?.quitAndInstall) return
    await api.quitAndInstall()
  },

  checkRtk: async () => {
    const api = window.oxe?.rtk
    if (!api?.checkForUpdate) return
    set({ rtk: { ...get().rtk, checking: true, error: null } })
    try {
      const rtk = await api.checkForUpdate()
      set({ rtk })
    } catch (err) {
      set({
        rtk: {
          ...get().rtk,
          checking: false,
          error: err instanceof Error ? err.message : String(err)
        }
      })
    }
  },

  updateRtk: async () => {
    const api = window.oxe?.rtk
    if (!api?.updateToLatest) return
    set({ rtk: { ...get().rtk, updating: true, error: null } })
    try {
      const rtk = await api.updateToLatest()
      set({ rtk })
    } catch (err) {
      set({
        rtk: {
          ...get().rtk,
          updating: false,
          error: err instanceof Error ? err.message : String(err)
        }
      })
    }
  },

  dismissBanner: () => {
    const v = get().app.availableVersion
    set({ dismissedVersion: v })
  }
}))
