import { afterEach, describe, expect, test, vi } from 'vitest'

const files = new Map<string, string>()
vi.mock('electron', () => ({
  app: { isPackaged: false, getVersion: () => '1.3.1', getPath: () => '/user-data' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: () => undefined }
}))
vi.mock('electron-log/main.js', () => ({ default: { info: () => undefined, warn: () => undefined } }))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const readFileSync = (path: string) => { if (!files.has(path)) throw Error('ENOENT'); return files.get(path) }
  const writeFileSync = (path: string, text: string) => { files.set(path, text) }
  return { ...actual, default: { ...actual, readFileSync, writeFileSync }, readFileSync, writeFileSync }
})

const { normalizeUpdatePreferences, updatePolicy, setUpdatePreferences, checkForAppUpdates, defaultChannel } = await import('../../electron/main/updater')

afterEach(() => vi.unstubAllGlobals())

describe('update preferences', () => {
  test('keep only known modes and valid versions', () => {
    expect(normalizeUpdatePreferences(undefined)).toEqual({ mode: 'auto', pinnedVersion: null, channel: 'stable' })
    expect(normalizeUpdatePreferences({ mode: 'notify', pinnedVersion: 'v1.3.1', channel: 'beta' })).toEqual({ mode: 'notify', pinnedVersion: '1.3.1', channel: 'beta' })
    expect(normalizeUpdatePreferences({ mode: 'sometimes', pinnedVersion: 'latest', channel: 'nightly' })).toEqual({ mode: 'auto', pinnedVersion: null, channel: 'stable' })
  })

  test('decide what runs on its own', () => {
    expect(updatePolicy({ mode: 'auto', pinnedVersion: null, channel: 'stable' })).toEqual({ periodic: true, autoDownload: true, autoInstall: true })
    expect(updatePolicy({ mode: 'notify', pinnedVersion: null, channel: 'stable' })).toEqual({ periodic: true, autoDownload: false, autoInstall: false })
    expect(updatePolicy({ mode: 'off', pinnedVersion: null, channel: 'stable' })).toEqual({ periodic: false, autoDownload: false, autoInstall: false })
    // A pinned version holds whatever the mode says.
    expect(updatePolicy({ mode: 'auto', pinnedVersion: '1.3.1', channel: 'stable' })).toEqual({ periodic: false, autoDownload: false, autoInstall: false })
  })

  test('are saved, shown in the state, and stop the checks that run on their own', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ tag_name: 'v1.4.0' }) }))
    vi.stubGlobal('fetch', fetch)
    const state = setUpdatePreferences({ mode: 'off', pinnedVersion: null })
    expect(state.preferences).toEqual({ mode: 'off', pinnedVersion: null, channel: 'stable' })
    expect(JSON.parse([...files.values()][0])).toEqual({ mode: 'off', pinnedVersion: null, channel: 'stable' })
    await checkForAppUpdates(false)
    expect(fetch).not.toHaveBeenCalled()
    // A check the person asks for still runs.
    expect((await checkForAppUpdates(true)).availableVersion).toBe('1.4.0')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test('a pre-release install starts on the beta channel; a saved choice wins', () => {
    expect(defaultChannel('1.4.0-beta.1')).toBe('beta')
    expect(defaultChannel('1.3.3')).toBe('stable')
    expect(normalizeUpdatePreferences(undefined, '1.4.0-beta.1').channel).toBe('beta')
    expect(normalizeUpdatePreferences({ channel: 'stable' }, '1.4.0-beta.1').channel).toBe('stable')
  })

  test('the beta channel reads the whole release list and offers a beta; stable reads only the latest', async () => {
    const fetch = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('per_page') ? [{ tag_name: 'v1.4.0-beta.2' }, { tag_name: 'v1.3.3' }] : { tag_name: 'v1.3.3' } }))
    vi.stubGlobal('fetch', fetch)
    setUpdatePreferences({ mode: 'notify', pinnedVersion: null, channel: 'beta' })
    expect((await checkForAppUpdates(true)).availableVersion).toBe('1.4.0-beta.2')
    expect(fetch.mock.calls[0][0]).toContain('per_page')
    setUpdatePreferences({ mode: 'notify', pinnedVersion: null, channel: 'stable' })
    expect((await checkForAppUpdates(true)).availableVersion).toBe('1.3.3')
    expect(fetch.mock.calls[1][0]).toMatch(/releases\/latest$/)
  })
})
