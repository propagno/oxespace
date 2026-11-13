import { describe, expect, test } from 'vitest'
import { AndroidDevices, isApkPath, type AdbResult } from '../../electron/main/services/android/android-devices'

const APK = process.platform === 'win32' ? 'C:\\builds\\app-debug.apk' : '/builds/app-debug.apk'
const LINK = 'oxespace://pair?v=3&host=192.168.0.10&port=47821&fp=AB:CD&code=7K2M9Q'

function fakeAdb(answer: (args: string[]) => Partial<AdbResult> = () => ({})) {
  const calls: Array<{ args: string[]; opts?: { shell?: boolean; timeoutMs?: number } }> = []
  const run = async (args: string[], opts?: { shell?: boolean; timeoutMs?: number }): Promise<AdbResult> => {
    calls.push({ args, opts })
    return { status: 0, stdout: '', stderr: '', ...answer(args) }
  }
  return { run, calls }
}

describe('the person\'s actions on a device, from the Android panel', () => {
  test('an APK path is a full path to a .apk, and nothing adb could read as an option', () => {
    expect(isApkPath(APK)).toBe(true)
    for (const path of ['app.apk', './app.apk', '-r', '--help.apk', `${APK}.exe`, `${APK}\n`, '', null, 42]) expect(isApkPath(path), String(path)).toBe(false)
  })

  test('install: one fixed shape, with the device named, no shell on this side and time to finish', async () => {
    const adb = fakeAdb(() => ({ stdout: 'Performing Streamed Install\nSuccess\n' }))
    const devices = new AndroidDevices({ run: adb.run })
    expect(await devices.installApk('emulator-5554', APK)).toEqual({ ok: true })
    expect(adb.calls).toEqual([{ args: ['-s', 'emulator-5554', 'install', '-r', APK], opts: { shell: false, timeoutMs: 180_000 } }])
  })

  test('install: the device\'s own reason when it refuses; a path that is not an APK never reaches adb', async () => {
    const adb = fakeAdb(() => ({ status: 1, stdout: '', stderr: 'adb: failed to install app-debug.apk: Failure [INSTALL_FAILED_VERSION_DOWNGRADE: Downgrade detected]' }))
    const devices = new AndroidDevices({ run: adb.run })
    expect(await devices.installApk('emulator-5554', APK)).toEqual({ ok: false, reason: 'INSTALL_FAILED_VERSION_DOWNGRADE: Downgrade detected' })
    adb.calls.length = 0
    for (const path of ['evil.apk', '-r', `${APK}; reboot`]) await expect(devices.installApk('emulator-5554', path), path).rejects.toThrow()
    await expect(devices.installApk('-s', APK)).rejects.toThrow()
    expect(adb.calls).toEqual([])
  })

  test('open a link: VIEW with the address as one quoted word; a refused address never reaches adb', async () => {
    const adb = fakeAdb(() => ({ stdout: 'Starting: Intent { act=android.intent.action.VIEW dat=https://example.com/... }\n' }))
    const devices = new AndroidDevices({ run: adb.run })
    expect(await devices.openLink('emulator-5554', 'https://example.com/a?b=1&c=2')).toEqual({ ok: true })
    expect(adb.calls.map(call => call.args)).toEqual([['-s', 'emulator-5554', 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', "'https://example.com/a?b=1&c=2'"]])
    adb.calls.length = 0
    for (const url of ["https://a.b/';id;'", 'https://a.b/$(reboot)', 'https://a.b/x\nreboot', 'intent://x#Intent;end', 'file:///sdcard/x', 'market://details?id=x', '-n com.x/.Y']) await expect(devices.openLink('emulator-5554', url), url).rejects.toThrow()
    expect(adb.calls).toEqual([])
  })

  test('open a link: nothing on the device takes it', async () => {
    const adb = fakeAdb(() => ({ stdout: 'Starting: Intent { ... }\n', stderr: 'Error: Activity not started, unable to resolve Intent { act=android.intent.action.VIEW }' }))
    expect(await new AndroidDevices({ run: adb.run }).openLink('emulator-5554', 'https://example.com')).toEqual({ ok: false, reason: 'Error: Activity not started, unable to resolve Intent { act=android.intent.action.VIEW }' })
  })

  test('the pairing link goes to the phone app only, as its own extra; anything else is refused before adb', async () => {
    const adb = fakeAdb(() => ({ stdout: 'Starting: Intent { cmp=com.oxespace.mobile/.MainActivity (has extras) }\n' }))
    const devices = new AndroidDevices({ run: adb.run })
    expect(await devices.sendPairLink('emulator-5554', LINK)).toEqual({ ok: true })
    expect(adb.calls.map(call => call.args)).toEqual([['-s', 'emulator-5554', 'shell', 'am', 'start', '-n', 'com.oxespace.mobile/.MainActivity', '--es', 'pair_link', `'${LINK}'`]])
    adb.calls.length = 0
    for (const link of ["oxespace://pair?v=3&code=x'y", 'oxespace://pair?v=3 x', 'https://example.com', 'oxespace://pair?v=$(id)']) await expect(devices.sendPairLink('emulator-5554', link), link).rejects.toThrow()
    expect(adb.calls).toEqual([])
  })

  test('the phone app on a device is read from dumpsys: absent, release or debug', async () => {
    const dump = (flags: string) => `Packages:\n  Package [com.oxespace.mobile] (1a2b):\n    versionName=1.5.0\n    pkgFlags=[ ${flags} ]\n`
    for (const [stdout, build] of [[dump('DEBUGGABLE HAS_CODE'), 'debug'], [dump('HAS_CODE ALLOW_BACKUP'), 'release'], ['Unable to find package: com.oxespace.mobile\n', 'absent']] as const) {
      const adb = fakeAdb(() => ({ stdout }))
      expect(await new AndroidDevices({ run: adb.run }).phoneApp('emulator-5554')).toBe(build)
      expect(adb.calls.map(call => call.args)).toEqual([['-s', 'emulator-5554', 'shell', 'dumpsys', 'package', 'com.oxespace.mobile']])
    }
    expect(await new AndroidDevices({ run: fakeAdb(() => ({ missing: true, status: null })).run }).phoneApp('emulator-5554')).toBe('absent')
  })

  test('the new shapes are the only new ones: the same subcommands in any other form stay refused', async () => {
    const adb = fakeAdb()
    const devices = new AndroidDevices({ run: adb.run })
    const refused = [
      ['install', APK], ['-s', 'emulator-5554', 'install', APK], ['-s', 'emulator-5554', 'install', '-r', '-g', APK], ['-s', 'emulator-5554', 'install', '-r', 'app.apk'], ['-s', 'emulator-5554', 'install-multiple', '-r', APK],
      ['-s', 'emulator-5554', 'shell', 'am', 'start', 'x'], ['-s', 'emulator-5554', 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'https://example.com'],
      ['-s', 'emulator-5554', 'shell', 'am', 'start', '-a', 'android.intent.action.CALL', '-d', "'https://example.com'"], ['-s', 'emulator-5554', 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', "'https://a.b/';reboot;'"],
      ['-s', 'emulator-5554', 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', "'intent://x'"], ['-s', 'emulator-5554', 'shell', 'am', 'start', '-n', 'com.bank/.Pay', '--es', 'pair_link', `'${LINK}'`],
      ['-s', 'emulator-5554', 'shell', 'am', 'start', '-n', 'com.oxespace.mobile/.MainActivity', '--es', 'other', `'${LINK}'`], ['-s', 'emulator-5554', 'shell', 'am', 'start', '-n', 'com.oxespace.mobile/.MainActivity', '--es', 'pair_link', LINK],
      ['-s', 'emulator-5554', 'shell', 'am', 'force-stop', 'com.oxespace.mobile'], ['-s', 'emulator-5554', 'shell', 'dumpsys', 'package', 'com.bank'], ['-s', 'emulator-5554', 'shell', 'dumpsys', 'package'], ['-s', 'emulator-5554', 'shell', 'pm', 'list', 'packages']
    ]
    for (const args of refused) await expect(devices.adb(args), args.join(' ')).rejects.toThrow()
    expect(adb.calls).toEqual([])
  })
})
