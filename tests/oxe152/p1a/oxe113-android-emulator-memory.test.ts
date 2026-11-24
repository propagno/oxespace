// @vitest-environment node
import { tmpdir } from 'node:os'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  app: { once: () => undefined, getPath: () => tmpdir() },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }
  }
}))

import { registerAndroidIpc } from '../../../electron/main/ipc/android.ipc'
import {
  AndroidAgentAccess,
  AndroidDevices,
  EMULATOR_LIGHTWEIGHT_MEMORY_MB,
  EMULATOR_MEMORY_THRESHOLD_MB,
  buildEmulatorArgs,
  checkEmulatorMemory,
  type AdbResult
} from '../../../electron/main/services/android/android-devices'
import { IPC_CHANNELS } from '../../../shared/types/ipc'

const MB = 1024 * 1024

describe('OXE-113 · Android emulator lightweight profile & memory check', () => {
  test('buildEmulatorArgs applies lightweight flags by default and when lightweight=true', () => {
    const expected = [
      '-avd',
      'Pixel_8_API_36',
      '-no-boot-anim',
      '-no-audio',
      '-memory',
      String(EMULATOR_LIGHTWEIGHT_MEMORY_MB),
      '-no-snapshot-save'
    ]
    expect(buildEmulatorArgs('Pixel_8_API_36')).toEqual(expected)
    expect(buildEmulatorArgs('Pixel_8_API_36', { lightweight: true })).toEqual(expected)
  })

  test('buildEmulatorArgs returns standard minimal args when lightweight=false', () => {
    expect(buildEmulatorArgs('Pixel_8_API_36', { lightweight: false })).toEqual(['-avd', 'Pixel_8_API_36'])
  })

  test('buildEmulatorArgs rejects invalid or option-like AVD names', () => {
    for (const invalid of ['', '-avd', '--help', 'Pixel 8', 'Pixel;rm']) {
      expect(() => buildEmulatorArgs(invalid)).toThrow('Invalid AVD name')
    }
  })

  test('checkEmulatorMemory enforces 2048 MB threshold for lightweight profile', () => {
    expect(checkEmulatorMemory({ lightweight: true, freeBytes: 1500 * MB })).toEqual({
      ok: false,
      freeMb: 1500,
      requiredMb: EMULATOR_MEMORY_THRESHOLD_MB.lightweight,
      lightweight: true
    })
    expect(checkEmulatorMemory({ lightweight: true, freeBytes: 2048 * MB })).toEqual({
      ok: true,
      freeMb: 2048,
      requiredMb: EMULATOR_MEMORY_THRESHOLD_MB.lightweight,
      lightweight: true
    })
    // Default (omitted lightweight) uses lightweight threshold
    expect(checkEmulatorMemory({ freeBytes: 2500 * MB })).toEqual({
      ok: true,
      freeMb: 2500,
      requiredMb: 2048,
      lightweight: true
    })
  })

  test('checkEmulatorMemory enforces 4096 MB threshold for standard profile', () => {
    expect(checkEmulatorMemory({ lightweight: false, freeBytes: 3072 * MB })).toEqual({
      ok: false,
      freeMb: 3072,
      requiredMb: EMULATOR_MEMORY_THRESHOLD_MB.standard,
      lightweight: false
    })
    expect(checkEmulatorMemory({ lightweight: false, freeBytes: 4096 * MB })).toEqual({
      ok: true,
      freeMb: 4096,
      requiredMb: EMULATOR_MEMORY_THRESHOLD_MB.standard,
      lightweight: false
    })
  })

  test('AndroidDevices.startAvd passes lightweight or standard args to emulator runner', async () => {
    const emulatorCalls: Array<{ args: string[]; detached?: boolean }> = []
    const devices = new AndroidDevices({
      run: async (): Promise<AdbResult> => ({ status: 0, stdout: 'List of devices attached\n', stderr: '' }),
      runEmulator: async (args, opts): Promise<AdbResult> => {
        emulatorCalls.push({ args, detached: opts?.detached })
        if (args[0] === '-list-avds') return { status: 0, stdout: 'Pixel_8_API_36\n', stderr: '' }
        return { status: 0, stdout: '', stderr: '' }
      }
    })

    await devices.startAvd('Pixel_8_API_36')
    await devices.startAvd('Pixel_8_API_36', { lightweight: false })

    const launchCalls = emulatorCalls.filter(call => call.args[0] === '-avd')
    expect(launchCalls).toEqual([
      {
        args: ['-avd', 'Pixel_8_API_36', '-no-boot-anim', '-no-audio', '-memory', '2048', '-no-snapshot-save'],
        detached: true
      },
      {
        args: ['-avd', 'Pixel_8_API_36'],
        detached: true
      }
    ])
  })
})

describe('OXE-113 · Android IPC memory check and launch profile', () => {
  beforeEach(() => handlers.clear())

  test('IPC exposes freeMemoryMb in status, checkEmulatorMemory, and forwards lightweight option on startEmulator', async () => {
    const launchArgs: string[][] = []
    const devices = new AndroidDevices({
      run: async (): Promise<AdbResult> => ({ status: 0, stdout: 'List of devices attached\n', stderr: '' }),
      runEmulator: async (args): Promise<AdbResult> => {
        if (args[0] === '-list-avds') return { status: 0, stdout: 'Pixel_8_API_36\n', stderr: '' }
        launchArgs.push(args)
        return { status: 0, stdout: '', stderr: '' }
      }
    })

    registerAndroidIpc({
      devices,
      access: new AndroidAgentAccess({ devices }),
      freeMemoryBytes: () => 1536 * MB
    })

    const status = (await handlers.get(IPC_CHANNELS.android.status)!({ sender: {} })) as {
      freeMemoryMb?: number
      avds: string[]
    }
    expect(status.freeMemoryMb).toBe(1536)
    expect(status.avds).toEqual(['Pixel_8_API_36'])

    const lowLight = await handlers.get(IPC_CHANNELS.android.checkEmulatorMemory)!({ sender: {} }, { lightweight: true })
    expect(lowLight).toEqual({ ok: false, freeMb: 1536, requiredMb: 2048, lightweight: true })

    const lowStd = await handlers.get(IPC_CHANNELS.android.checkEmulatorMemory)!({ sender: {} }, { lightweight: false })
    expect(lowStd).toEqual({ ok: false, freeMb: 1536, requiredMb: 4096, lightweight: false })

    await handlers.get(IPC_CHANNELS.android.startEmulator)!({ sender: {} }, 'Pixel_8_API_36', { lightweight: true })
    await handlers.get(IPC_CHANNELS.android.startEmulator)!({ sender: {} }, 'Pixel_8_API_36', { lightweight: false })

    expect(launchArgs).toEqual([
      ['-avd', 'Pixel_8_API_36', '-no-boot-anim', '-no-audio', '-memory', '2048', '-no-snapshot-save'],
      ['-avd', 'Pixel_8_API_36']
    ])
  })
})
