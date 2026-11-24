// @vitest-environment node
// OXE-112 (part B): IPC wiring for owned emulator stop control and unexpected device disconnect notifications.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, input: unknown) => unknown>()
const broadcasts: Array<{ channel: string; payload: unknown }> = []

vi.mock('electron', () => ({
  app: { once: () => undefined, getPath: () => '/tmp' },
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: { send: (channel: string, payload: unknown) => { broadcasts.push({ channel, payload }) } }
    }],
    fromWebContents: () => null
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: (channel: string, handler: (event: unknown, input: unknown) => unknown) => { handlers.set(channel, handler) } }
}))

import { registerAndroidIpc, type AndroidDeviceDisconnectedEvent } from '../../../electron/main/ipc/android.ipc'
import { AndroidAgentAccess, AndroidDevices, type AdbResult, type AdbRunner, type EmulatorRunner } from '../../../electron/main/services/android/android-devices'
import { IPC_CHANNELS, type AndroidMirrorStatus } from '../../../shared/types/ipc'

const ok = (stdout = ''): AdbResult => ({ status: 0, stdout, stderr: '' })

function setup(options: { devices?: Record<string, { state: string; model: string }>; avds?: string[]; watchIntervalMs?: number } = {}) {
  handlers.clear()
  broadcasts.length = 0
  const list: Record<string, { state: string; model: string }> = { ...(options.devices ?? {}) }
  const avdNames: Record<string, string> = {}
  const adbCalls: string[] = []

  const run: AdbRunner = async args => {
    const line = args.join(' ')
    adbCalls.push(line)
    if (line === 'devices -l') {
      const rows = Object.entries(list).map(([serial, info]) => `${serial}          ${info.state} model:${info.model}`)
      return ok(['List of devices attached', ...rows].join('\n') + '\n')
    }
    if (line.endsWith('shell getprop ro.build.version.sdk')) return ok('36\n')
    if (line.endsWith('dumpsys package com.oxespace.mobile')) return ok('Unable to find package: com.oxespace.mobile\n')
    if (line.endsWith('exec-out screencap -p')) return { status: 0, stdout: Buffer.from([0x89, 0x50, 0x4e, 0x47]), stderr: '' }
    const avdName = /^-s (\S+) emu avd name$/.exec(line)
    if (avdName) return avdNames[avdName[1]] ? ok(`${avdNames[avdName[1]]}\nOK\n`) : { status: 1, stdout: '', stderr: 'not an emulator' }
    const kill = /^-s (\S+) emu kill$/.exec(line)
    if (kill) { delete list[kill[1]]; return ok('OK: killing emulator\n') }
    return ok()
  }

  const runEmulator: EmulatorRunner = async args => {
    if (args[0] === '-list-avds') return ok((options.avds ?? ['Pixel_8_API_36']).join('\n') + '\n')
    return { ...ok(), pid: 4242 }
  }

  const devices = new AndroidDevices({ run, runEmulator, killProcess: () => undefined, sleep: async () => undefined })
  const accessEvents: Array<{ serial: string; sessionKeys: string[] }> = []
  const access = new AndroidAgentAccess({ devices, onDeviceDisconnected: info => { accessEvents.push(info) } })
  const ipcDisconnectEvents: AndroidDeviceDisconnectedEvent[] = []
  const dispose = registerAndroidIpc({
    devices,
    access,
    watchIntervalMs: options.watchIntervalMs ?? 500,
    onDeviceDisconnected: event => { ipcDisconnectEvents.push(event) }
  })

  const call = <T,>(channel: string, input?: unknown): Promise<T> =>
    Promise.resolve(handlers.get(channel)!({ sender: {} }, input)) as Promise<T>

  const boot = (serial: string, avd: string, model = 'Pixel_8') => {
    list[serial] = { state: 'device', model }
    avdNames[serial] = avd
  }

  return { call, list, avdNames, adbCalls, devices, access, accessEvents, ipcDisconnectEvents, dispose, boot }
}

const disposers: Array<() => void> = []
beforeEach(() => { handlers.clear(); broadcasts.length = 0 })
afterEach(() => {
  while (disposers.length) disposers.pop()?.()
  vi.useRealTimers()
})

describe('OXE-112 (B) · Android IPC ownership and disconnect notifications', () => {
  test('status flags OXESpace-started emulators as owned and leaves external emulators and USB phones unowned', async () => {
    const ctx = setup({
      devices: {
        'emulator-5556': { state: 'device', model: 'External_Pixel' },
        R58N12345: { state: 'device', model: 'Galaxy_S23' }
      }
    })
    disposers.push(ctx.dispose)
    ctx.avdNames['emulator-5556'] = 'Other_AVD'

    await ctx.call(IPC_CHANNELS.android.startEmulator, 'Pixel_8_API_36')
    ctx.boot('emulator-5554', 'Pixel_8_API_36', 'Pixel_8')

    const status = await ctx.call<AndroidMirrorStatus>(IPC_CHANNELS.android.status)
    const bySerial = Object.fromEntries(status.devices.map(d => [d.serial, d]))
    expect(bySerial['emulator-5554']?.owned).toBe(true)
    expect(bySerial['emulator-5556']?.owned).toBeUndefined()
    expect(bySerial.R58N12345?.owned).toBeUndefined()
  })

  test('stopEmulator stops an owned emulator without raising a disconnect notice, and refuses external or USB devices', async () => {
    vi.useFakeTimers()
    const ctx = setup({
      devices: {
        'emulator-5556': { state: 'device', model: 'External_Pixel' },
        R58N12345: { state: 'device', model: 'Galaxy_S23' }
      }
    })
    disposers.push(ctx.dispose)
    ctx.avdNames['emulator-5556'] = 'Other_AVD'

    expect(await ctx.call(IPC_CHANNELS.androidActions.stopEmulator, { serial: 'emulator-5556' })).toEqual({
      ok: false,
      reason: 'android.avd.notOwned'
    })
    expect(await ctx.call(IPC_CHANNELS.androidActions.stopEmulator, { serial: 'R58N12345' })).toEqual({
      ok: false,
      reason: 'android.avd.notOwned'
    })

    await ctx.call(IPC_CHANNELS.android.startEmulator, 'Pixel_8_API_36')
    ctx.boot('emulator-5554', 'Pixel_8_API_36', 'Pixel_8')
    await vi.advanceTimersByTimeAsync(600)

    expect(await ctx.call(IPC_CHANNELS.androidActions.stopEmulator, { serial: 'emulator-5554' })).toEqual({ ok: true })
    await vi.advanceTimersByTimeAsync(1_000)

    expect(ctx.ipcDisconnectEvents).toEqual([])
    const status = await ctx.call<AndroidMirrorStatus>(IPC_CHANNELS.android.status)
    expect(status.disconnectedDevice).toBeUndefined()
    expect(status.devices.some(d => d.serial === 'emulator-5554')).toBe(false)
  })

  test('an unexpected disconnect surfaces disconnectedDevice in status, revokes agent grants, and notifies active agent sessions', async () => {
    vi.useFakeTimers()
    const ctx = setup({
      devices: {
        'emulator-5554': { state: 'device', model: 'Pixel_8' },
        R58N12345: { state: 'device', model: 'Galaxy_S23' }
      }
    })
    disposers.push(ctx.dispose)

    // Populate known device metadata and grant an agent session screenshot access.
    await ctx.call(IPC_CHANNELS.android.status)
    ctx.access.setAgentsCanSee('emulator-5554', true)
    const shot = await ctx.access.screenshot({
      serial: 'emulator-5554',
      sessionKey: 'thread:t-42',
      ask: async () => true
    })
    expect(shot.ok).toBe(true)
    expect(ctx.access.activeSessionsFor('emulator-5554')).toEqual(['thread:t-42'])

    await vi.advanceTimersByTimeAsync(600)
    delete ctx.list['emulator-5554']
    await vi.advanceTimersByTimeAsync(1_000)

    expect(ctx.accessEvents).toEqual([{ serial: 'emulator-5554', sessionKeys: ['thread:t-42'] }])
    expect(ctx.access.activeSessionsFor('emulator-5554')).toEqual([])
    expect(ctx.access.lastDisconnectedAt('emulator-5554')).not.toBeNull()
    expect(ctx.ipcDisconnectEvents).toHaveLength(1)
    expect(ctx.ipcDisconnectEvents[0]).toMatchObject({
      serial: 'emulator-5554',
      name: 'Pixel 8',
      kind: 'emulator',
      sessionKeys: ['thread:t-42']
    })

    const status = await ctx.call<AndroidMirrorStatus>(IPC_CHANNELS.android.status)
    expect(status.disconnectedDevice).toMatchObject({
      serial: 'emulator-5554',
      name: 'Pixel 8',
      kind: 'emulator'
    })
    expect(broadcasts.some(b => b.channel === IPC_CHANNELS.android.changed)).toBe(true)

    // When the device comes back, disconnectedDevice is cleared.
    ctx.list['emulator-5554'] = { state: 'device', model: 'Pixel_8' }
    const recovered = await ctx.call<AndroidMirrorStatus>(IPC_CHANNELS.android.status)
    expect(recovered.disconnectedDevice).toBeUndefined()
  })
})
