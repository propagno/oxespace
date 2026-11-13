// @vitest-environment node
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, input: unknown) => unknown>()
vi.mock('electron', () => ({
  app: { once: () => undefined, getPath: () => tmpdir() },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: (channel: string, handler: (event: unknown, input: unknown) => unknown) => { handlers.set(channel, handler) } }
}))

import { registerAndroidIpc } from '../../electron/main/ipc/android.ipc'
import { AndroidAgentAccess, AndroidDevices, type AdbResult } from '../../electron/main/services/android/android-devices'
import { IPC_CHANNELS } from '../../shared/types/ipc'

const LINK = 'oxespace://pair?v=3&host=192.168.0.10&port=47821&fp=AB:CD&code=7K2M9Q'
const DEVICES = 'List of devices attached\nemulator-5554          device product:sdk model:Pixel_8 device:emu transport_id:1\nR5CT1                  unauthorized usb:1-2 transport_id:2\n'
const dumpsys = (build: 'debug' | 'release' | 'absent') => build === 'absent' ? 'Unable to find package: com.oxespace.mobile' : `Packages:\n  Package [com.oxespace.mobile] (1a):\n    pkgFlags=[ ${build === 'debug' ? 'DEBUGGABLE ' : ''}HAS_CODE ]\n`

function setup(options: { build?: 'debug' | 'release' | 'absent'; pick?: string | null; install?: Partial<AdbResult>; pairing?: () => Promise<{ uri: string; expiresAt: number }> } = {}) {
  handlers.clear()
  const calls: string[][] = []
  const run = async (args: string[]): Promise<AdbResult> => {
    calls.push(args)
    if (args[0] === 'devices') return { status: 0, stdout: DEVICES, stderr: '' }
    if (args[3] === 'getprop') return { status: 0, stdout: '36\n', stderr: '' }
    if (args[3] === 'dumpsys') return { status: 0, stdout: dumpsys(options.build ?? 'absent'), stderr: '' }
    if (args[2] === 'install') return { status: 0, stdout: 'Success\n', stderr: '', ...options.install }
    return { status: 0, stdout: 'Starting: Intent { ... }\n', stderr: '' }
  }
  const devices = new AndroidDevices({ run, runEmulator: async () => ({ status: 0, stdout: '', stderr: '' }) })
  const audit = vi.fn()
  const pickApk = vi.fn(async () => options.pick ?? null)
  registerAndroidIpc({ devices, access: new AndroidAgentAccess({ devices }), pickApk, audit, ...(options.pairing ? { startPairing: options.pairing } : {}) })
  const call = <T,>(channel: string, input: unknown): Promise<T> => Promise.resolve(handlers.get(channel)!({ sender: {} }, input)) as Promise<T>
  return { call, calls, audit, pickApk, adbCommands: () => calls.filter(args => args[0] !== 'devices' && args[3] !== 'getprop' && args[3] !== 'dumpsys') }
}

function apkFile(name = 'app-debug.apk', bytes = 2048): string {
  const path = join(mkdtempSync(join(tmpdir(), 'oxe-apk-')), name)
  writeFileSync(path, Buffer.alloc(bytes, 1))
  return path
}

describe('the Android panel\'s actions, as main carries them out', () => {
  beforeEach(() => handlers.clear())

  test('install: the person picks the file in the system\'s dialog, then says yes; the window never names a path', async () => {
    const path = apkFile()
    const { call, adbCommands, audit } = setup({ pick: path })
    const pick = await call<{ id: string; name: string; sizeBytes: number }>(IPC_CHANNELS.androidActions.pickApk, { serial: 'emulator-5554' })
    expect(pick).toMatchObject({ name: 'app-debug.apk', sizeBytes: 2048 })
    expect(JSON.stringify(pick)).not.toContain(path)
    expect(adbCommands()).toEqual([])
    expect(await call(IPC_CHANNELS.androidActions.installApk, { serial: 'emulator-5554', id: pick.id })).toEqual({ ok: true })
    expect(adbCommands()).toEqual([['-s', 'emulator-5554', 'install', '-r', path]])
    expect(audit).toHaveBeenCalledWith({ action: 'android-install-apk', target: 'emulator-5554', outcome: 'ok', detail: 'app-debug.apk' })
  })

  test('install: a path sent by the window, a second use of a yes, another device or a changed file install nothing', async () => {
    const path = apkFile()
    const { call, adbCommands } = setup({ pick: path })
    expect(await call(IPC_CHANNELS.androidActions.installApk, { serial: 'emulator-5554', id: path, path })).toEqual({ ok: false, reason: 'pick-expired' })
    const first = await call<{ id: string }>(IPC_CHANNELS.androidActions.pickApk, { serial: 'emulator-5554' })
    await call(IPC_CHANNELS.androidActions.installApk, { serial: 'emulator-5554', id: first.id })
    expect(await call(IPC_CHANNELS.androidActions.installApk, { serial: 'emulator-5554', id: first.id })).toEqual({ ok: false, reason: 'pick-expired' })
    const second = await call<{ id: string }>(IPC_CHANNELS.androidActions.pickApk, { serial: 'emulator-5554' })
    writeFileSync(path, Buffer.alloc(4096, 2))
    expect(await call(IPC_CHANNELS.androidActions.installApk, { serial: 'emulator-5554', id: second.id })).toEqual({ ok: false, reason: 'file-changed' })
    expect(adbCommands()).toHaveLength(1)
  })

  test('install: cancelled, not an APK, a link to a file, or a device that is not ready', async () => {
    expect(await setup({ pick: null }).call(IPC_CHANNELS.androidActions.pickApk, { serial: 'emulator-5554' })).toBeNull()
    await expect(setup({ pick: apkFile('notes.txt') }).call(IPC_CHANNELS.androidActions.pickApk, { serial: 'emulator-5554' })).rejects.toThrow('Not an APK file')
    const real = apkFile()
    const link = join(mkdtempSync(join(tmpdir(), 'oxe-apk-link-')), 'linked.apk')
    let linked = true
    try { symlinkSync(real, link) } catch { linked = false }
    if (linked) await expect(setup({ pick: link }).call(IPC_CHANNELS.androidActions.pickApk, { serial: 'emulator-5554' })).rejects.toThrow('Not an APK file')
    const blocked = setup({ pick: real })
    await expect(blocked.call(IPC_CHANNELS.androidActions.pickApk, { serial: 'R5CT1' })).rejects.toThrow('not connected')
    await expect(blocked.call(IPC_CHANNELS.androidActions.pickApk, { serial: 'emulator-9999' })).rejects.toThrow('not connected')
    await expect(blocked.call(IPC_CHANNELS.androidActions.pickApk, { serial: '-s' })).rejects.toThrow()
    expect(blocked.pickApk).not.toHaveBeenCalled()
  })

  test('install: the device\'s refusal comes back in its own words and is recorded as an error', async () => {
    const { call, audit } = setup({ pick: apkFile(), install: { status: 1, stdout: '', stderr: 'adb: failed to install: Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]' } })
    const pick = await call<{ id: string }>(IPC_CHANNELS.androidActions.pickApk, { serial: 'emulator-5554' })
    expect(await call(IPC_CHANNELS.androidActions.installApk, { serial: 'emulator-5554', id: pick.id })).toEqual({ ok: false, reason: 'INSTALL_FAILED_INSUFFICIENT_STORAGE' })
    expect(audit).toHaveBeenCalledWith({ action: 'android-install-apk', target: 'emulator-5554', outcome: 'error', detail: 'INSTALL_FAILED_INSUFFICIENT_STORAGE' })
  })

  test('open a link: sent as one quoted word; the record keeps the site, never the full address', async () => {
    const { call, adbCommands, audit } = setup()
    expect(await call(IPC_CHANNELS.androidActions.openLink, { serial: 'emulator-5554', url: 'https://example.com/reset?token=SECRET&x=1' })).toEqual({ ok: true })
    expect(adbCommands()).toEqual([['-s', 'emulator-5554', 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', "'https://example.com/reset?token=SECRET&x=1'"]])
    expect(audit).toHaveBeenCalledWith({ action: 'android-open-link', target: 'emulator-5554', outcome: 'ok', detail: 'https://example.com' })
    expect(JSON.stringify(audit.mock.calls)).not.toContain('SECRET')
  })

  test('open a link: a refused address says why and reaches neither adb nor the record', async () => {
    const { call, adbCommands, audit } = setup()
    expect(await call(IPC_CHANNELS.androidActions.openLink, { serial: 'emulator-5554', url: "https://a.b/';reboot;'" })).toEqual({ ok: false, reason: 'refused:characters' })
    expect(await call(IPC_CHANNELS.androidActions.openLink, { serial: 'emulator-5554', url: 'intent://x#Intent;end' })).toEqual({ ok: false, reason: 'refused:scheme' })
    expect(await call(IPC_CHANNELS.androidActions.openLink, { serial: 'emulator-5554' })).toEqual({ ok: false, reason: 'refused:empty' })
    expect(adbCommands()).toEqual([])
    expect(audit).not.toHaveBeenCalled()
  })

  test('pair: only a debug build of the phone app is handed the link, which main opens itself', async () => {
    const pairing = vi.fn(async () => ({ uri: LINK, expiresAt: 1 }))
    const debug = setup({ build: 'debug', pairing })
    expect(await debug.call(IPC_CHANNELS.androidActions.pair, { serial: 'emulator-5554', link: 'oxespace://pair?v=3&host=6.6.6.6' })).toEqual({ ok: true })
    expect(debug.adbCommands()).toEqual([['-s', 'emulator-5554', 'shell', 'am', 'start', '-n', 'com.oxespace.mobile/.MainActivity', '--es', 'pair_link', `'${LINK}'`]])
    expect(debug.audit).toHaveBeenCalledWith({ action: 'android-pair-link', target: 'emulator-5554', outcome: 'ok', detail: null })
    expect(JSON.stringify(debug.audit.mock.calls)).not.toContain('7K2M9Q')
    for (const build of ['release', 'absent'] as const) {
      const other = setup({ build, pairing })
      expect(await other.call(IPC_CHANNELS.androidActions.pair, { serial: 'emulator-5554' })).toEqual({ ok: false, reason: 'not-debug-build' })
      expect(other.adbCommands()).toEqual([])
    }
    expect(pairing).toHaveBeenCalledTimes(1)
  })

  test('pair: with phone connections off, nothing is sent and the reason comes back', async () => {
    const closed = setup({ build: 'debug', pairing: async () => { throw new Error('Turn the gateway on first') } })
    expect(await closed.call(IPC_CHANNELS.androidActions.pair, { serial: 'emulator-5554' })).toEqual({ ok: false, reason: 'pairing-closed:Turn the gateway on first' })
    expect(closed.adbCommands()).toEqual([])
    expect(await setup({ build: 'debug' }).call(IPC_CHANNELS.androidActions.pair, { serial: 'emulator-5554' })).toEqual({ ok: false, reason: 'pairing-unavailable' })
  })

  test('the status says which build of the phone app each ready device has', async () => {
    const { call } = setup({ build: 'debug' })
    const status = await call<{ devices: Array<{ serial: string; phoneApp?: string }> }>(IPC_CHANNELS.android.status, undefined)
    expect(status.devices.map(device => [device.serial, device.phoneApp])).toEqual([['emulator-5554', 'debug'], ['R5CT1', undefined]])
  })
})
