import { create } from 'zustand'
import { i18n } from '../i18n'
import type { AppUpdatePreferences, AppUpdateState } from '../../shared/types/updater'
import { confirmClose } from '../lib/closeGuard'
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

/** The restart in progress, question included: a second click while it is open shares it and installs nothing more. */
let restarting: Promise<void> | null = null

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

  // Main's quitAndInstallUpdate() bypasses the close guard, so the window asks here first: the same question as
  // File › Exit. Unsaved work or a turn in progress (working or waiting for approval) opens the dialog, and Cancel
  // installs nothing. One restart at a time: clicks while the question is open share its answer.
  quitAndInstall: () => {
    restarting ??= (async () => {
      try {
        const api = window.oxe?.app
        if (!api?.quitAndInstall) return
        if (!(await confirmClose('quit'))) return
        await api.quitAndInstall()
      } finally {
        restarting = null
      }
    })()
    return restarting
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
