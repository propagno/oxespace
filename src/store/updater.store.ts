import { create } from 'zustand'
import { i18n } from '../i18n'
import type { AppUpdatePreferences, AppUpdateState } from '../../shared/types/updater'
import { humanizeError } from '../utils/humanizeError'

interface UpdaterStore {
  app: AppUpdateState
  dismissedVersion: string | null
  bootstrap: () => void
  checkAppUpdates: () => Promise<void>
  quitAndInstall: () => Promise<void>
  downloadAppUpdate: () => Promise<void>
  setUpdatePreferences: (preferences: AppUpdatePreferences) => Promise<void>
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

let unsubApp: (() => void) | null = null

export const useUpdaterStore = create<UpdaterStore>((set, get) => ({
  app: APP_DEFAULT,
  dismissedVersion: null,

  bootstrap: () => {
    const api = typeof window !== 'undefined' ? window.oxe : undefined
    if (!api?.app?.getUpdateState) {
      set({
        app: {
          ...APP_DEFAULT,
          status: 'disabled',
          error: i18n.t('updates.devBuild'),
          lastCheckedAt: Date.now()
        }
      })
      return
    }

    void api.app.getUpdateState().then((app) => set({ app })).catch(() => undefined)

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
          error: humanizeError(err)
        }
      })
    }
  },

  quitAndInstall: async () => {
    const api = window.oxe?.app
    if (!api?.quitAndInstall) return
    await api.quitAndInstall()
  },

  downloadAppUpdate: async () => {
    const api = window.oxe?.app
    if (!api?.downloadUpdate) return
    try { set({ app: await api.downloadUpdate() }) } catch (err) { set({ app: { ...get().app, status: 'error', error: humanizeError(err) } }) }
  },

  setUpdatePreferences: async (preferences) => {
    const api = window.oxe?.app
    if (!api?.setUpdatePreferences) return
    try { set({ app: await api.setUpdatePreferences(preferences) }) } catch (err) { set({ app: { ...get().app, error: humanizeError(err) } }) }
  },

  dismissBanner: () => {
    const v = get().app.availableVersion
    set({ dismissedVersion: v })
  }
}))
