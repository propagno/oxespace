// OXE-112 (part A): the Android device service owns the emulators OXESpace starts, and only those. It records the AVD
// it launched (with the emulator's process id), learns its serial once it boots, stops only what it owns (adb emu kill,
// then SIGTERM after 5 s if the emulator is still there), and reports a device that leaves adb within the watch
// interval. A fake adb and emulator only: no device, no emulator, no network.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { AndroidDevices, type AdbResult, type AdbRunner, type EmulatorRunner } from '../../../electron/main/services/android/android-devices'

const ok = (stdout = ''): AdbResult => ({ status: 0, stdout, stderr: '' })

/** adb with a device list the test controls, emulator AVD names, and emu kill that removes the emulator. */
function fake(options: { avds?: string[]; devices?: Record<string, string>; killWorks?: boolean } = {}) {
  const devices: Record<string, string> = { ...(options.devices ?? {}) }
  const names: Record<string, string> = {}
  const adbCalls: string[] = []
  const emulatorCalls: string[] = []
  const run: AdbRunner = async args => {
    const line = args.join(' ')
    adbCalls.push(line)
    if (line === 'devices -l') return ok(['List of devices attached', ...Object.entries(devices).map(([serial, state]) => `${serial}          ${state} model:Pixel_8`)].join('\n') + '\n')
    if (line.endsWith('shell getprop ro.build.version.sdk')) return ok('36\n')
    const avdName = /^-s (\S+) emu avd name$/.exec(line)
    if (avdName) return names[avdName[1]] ? ok(`${names[avdName[1]]}\nOK\n`) : { status: 1, stdout: '', stderr: 'not an emulator' }
    const kill = /^-s (\S+) emu kill$/.exec(line)
    if (kill) { if (options.killWorks !== false) delete devices[kill[1]]; return ok('OK: killing emulator\n') }
    return { status: 1, stdout: '', stderr: `unexpected ${line}` }
  }
  const runEmulator: EmulatorRunner = async args => {
    emulatorCalls.push(args.join(' '))
    if (args[0] === '-list-avds') return ok((options.avds ?? ['Pixel_8_API_36']).join('\n') + '\n')
    return { ...ok(), pid: 4242 }
  }
  /** The emulator the test "boots": it appears in adb devices with its AVD name. */
  const boot = (serial: string, avd: string) => { devices[serial] = 'device'; names[serial] = avd }
  return { run, runEmulator, devices, names, adbCalls, emulatorCalls, boot }
}

const killed: Array<{ pid: number; signal: string }> = []
const killProcess = (pid: number, signal: string) => { killed.push({ pid, signal }) }
const sleep = async () => undefined

beforeEach(() => { killed.length = 0 })
afterEach(() => { vi.useRealTimers() })

describe('OXE-112 (A) · the emulators OXESpace starts are its own, and only those', () => {
  test('startAvd records the AVD it launched, and the serial once it boots', async () => {
    const adb = fake()
    const devices = new AndroidDevices({ run: adb.run, runEmulator: adb.runEmulator, killProcess, sleep })
    await devices.startAvd('Pixel_8_API_36')
    expect(adb.emulatorCalls).toContain('-avd Pixel_8_API_36')
    expect(devices.ownsSerial('emulator-5554')).toBe(false)
    adb.boot('emulator-5554', 'Pixel_8_API_36')
    expect(await devices.ownedSerials()).toEqual(['emulator-5554'])
    expect(devices.ownsSerial('emulator-5554')).toBe(true)
  })

  test('an emulator started outside OXESpace is never stopped by it', async () => {
    const adb = fake({ devices: { 'emulator-5556': 'device' } })
    adb.names['emulator-5556'] = 'Pixel_8_API_36'
    const devices = new AndroidDevices({ run: adb.run, runEmulator: adb.runEmulator, killProcess, sleep })
    expect(await devices.stopAvd('emulator-5556')).toEqual({ ok: false, reason: 'android.avd.notOwned' })
    await devices.stopOwned()
    expect(adb.adbCalls.filter(line => line.includes('emu kill'))).toEqual([])
    expect(killed).toEqual([])
  })

  test('a physical device is never stopped', async () => {
    const adb = fake({ devices: { R58N12345: 'device' } })
    const devices = new AndroidDevices({ run: adb.run, runEmulator: adb.runEmulator, killProcess, sleep })
    expect(await devices.stopAvd('R58N12345')).toEqual({ ok: false, reason: 'android.avd.notOwned' })
    expect(adb.adbCalls.filter(line => line.includes('emu'))).toEqual([])
  })

  test('stopAvd stops an owned emulator with adb emu kill and forgets it', async () => {
    const adb = fake()
    const devices = new AndroidDevices({ run: adb.run, runEmulator: adb.runEmulator, killProcess, sleep })
    await devices.startAvd('Pixel_8_API_36')
    adb.boot('emulator-5554', 'Pixel_8_API_36')
    await devices.ownedSerials()
    expect(await devices.stopAvd('emulator-5554')).toEqual({ ok: true })
    expect(adb.adbCalls).toContain('-s emulator-5554 emu kill')
    expect(killed).toEqual([])
    expect(devices.ownsSerial('emulator-5554')).toBe(false)
  })

  test('an owned emulator still there after the grace gets SIGTERM on the process OXESpace started', async () => {
    const adb = fake({ killWorks: false })
    const devices = new AndroidDevices({ run: adb.run, runEmulator: adb.runEmulator, killProcess, sleep, stopGraceMs: 5_000 })
    await devices.startAvd('Pixel_8_API_36')
    adb.boot('emulator-5554', 'Pixel_8_API_36')
    await devices.ownedSerials()
    expect(await devices.stopAvd('emulator-5554')).toEqual({ ok: true })
    expect(killed).toEqual([{ pid: 4242, signal: 'SIGTERM' }])
  })

  test('stopOwned stops every owned emulator, for the app quitting', async () => {
    const adb = fake({ avds: ['Pixel_8_API_36', 'Small_API_34'] })
    const devices = new AndroidDevices({ run: adb.run, runEmulator: adb.runEmulator, killProcess, sleep })
    await devices.startAvd('Pixel_8_API_36')
    await devices.startAvd('Small_API_34')
    adb.boot('emulator-5554', 'Pixel_8_API_36')
    adb.boot('emulator-5556', 'Small_API_34')
    await devices.stopOwned()
    expect(adb.adbCalls.filter(line => line.endsWith('emu kill')).sort()).toEqual(['-s emulator-5554 emu kill', '-s emulator-5556 emu kill'])
  })

  test('emu commands are not reachable through the public adb allowlist', async () => {
    const devices = new AndroidDevices({ run: fake().run })
    await expect(devices.adb(['-s', 'emulator-5554', 'emu', 'kill'])).rejects.toThrow(/allowlist/)
  })
})

describe('OXE-112 (A) · a device that leaves adb is reported within the watch interval', () => {
  test('watchDevices reports the serial that left, within 5 seconds', async () => {
    vi.useFakeTimers()
    const adb = fake({ devices: { 'emulator-5554': 'device', R58N12345: 'device' } })
    const devices = new AndroidDevices({ run: adb.run, runEmulator: adb.runEmulator, killProcess, sleep })
    const left: string[] = []
    const stop = devices.watchDevices({ onDisconnected: serial => { left.push(serial) } })
    await vi.advanceTimersByTimeAsync(2_500)
    delete adb.devices['emulator-5554']
    await vi.advanceTimersByTimeAsync(5_000)
    stop()
    expect(left).toEqual(['emulator-5554'])
  })
})
