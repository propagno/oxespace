// OXE-111 (part A): the Android lifecycle operations agents will call through MCP (avd_start, apk_install, app_launch,
// logcat_tail), as a service. Inputs are checked before anything is asked or spawned; the three that change a device
// ask the person first, showing the action, the device and the exact target, and run nothing when refused; every
// command is a fixed argument list with no shell and its own timeout; logcat is bounded in lines and bytes. The MCP
// registration and the person_action_audit wiring follow in part B. A fake adb and emulator only.
import { describe, expect, test } from 'vitest'
import { AndroidDevices, type AdbResult, type AdbRunner, type EmulatorRunner } from '../../../electron/main/services/android/android-devices'
import { AndroidLifecycle, type LifecyclePrompt } from '../../../electron/main/services/android/android-lifecycle'

const WORKSPACE = process.platform === 'win32' ? 'C:\\work\\app' : '/work/app'
const APK = process.platform === 'win32' ? 'C:\\work\\app\\build\\app-debug.apk' : '/work/app/build/app-debug.apk'
const OUTSIDE = process.platform === 'win32' ? 'C:\\work\\app\\..\\evil\\evil.apk' : '/work/app/../evil/evil.apk'

interface Call { args: string[]; shell?: boolean; timeoutMs?: number }

function harness(options: { approve?: boolean; logcat?: string; visible?: boolean } = {}) {
  const adbCalls: Call[] = []
  const emulatorCalls: string[][] = []
  const prompts: LifecyclePrompt[] = []
  const audit: Array<{ action: string; target: string; outcome: string }> = []
  const run: AdbRunner = async (args, opts) => {
    adbCalls.push({ args, shell: opts?.shell, timeoutMs: opts?.timeoutMs })
    const line = args.join(' ')
    if (line.includes(' install ')) return { status: 0, stdout: 'Performing Streamed Install\nSuccess\n', stderr: '' }
    if (line.includes(' monkey ')) return { status: 0, stdout: 'Events injected: 1\n', stderr: '' }
    if (line.includes(' logcat ')) return { status: 0, stdout: options.logcat ?? '', stderr: '' }
    return { status: 1, stdout: '', stderr: `unexpected ${line}` }
  }
  const runEmulator: EmulatorRunner = async args => {
    emulatorCalls.push(args)
    if (args[0] === '-list-avds') return { status: 0, stdout: 'Pixel_8_API_36\n', stderr: '' } as AdbResult
    return { status: 0, stdout: '', stderr: '' }
  }
  const devices = new AndroidDevices({ run, runEmulator })
  const lifecycle = new AndroidLifecycle({
    devices,
    run,
    approve: async prompt => { prompts.push(prompt); return options.approve ?? true },
    agentsCanSee: () => options.visible ?? true,
    audit: { record: entry => { audit.push(entry) } },
  })
  const spawned = () => adbCalls.length + emulatorCalls.filter(args => args[0] !== '-list-avds').length
  return { lifecycle, adbCalls, emulatorCalls, prompts, audit, spawned }
}

describe('OXE-111 (A) · CA-1: avd_start, apk_install and app_launch ask first, and run nothing when refused', () => {
  test('a refused avd_start, apk_install or app_launch runs zero commands and says it was refused', async () => {
    const h = harness({ approve: false })
    expect(await h.lifecycle.avdStart({ avdName: 'Pixel_8_API_36' })).toEqual({ ok: false, code: 'android.lifecycle.denied' })
    expect(await h.lifecycle.apkInstall({ serial: 'emulator-5554', apkPath: APK, workspaceRoot: WORKSPACE })).toEqual({ ok: false, code: 'android.lifecycle.denied' })
    expect(await h.lifecycle.appLaunch({ serial: 'emulator-5554', packageName: 'com.example.app' })).toEqual({ ok: false, code: 'android.lifecycle.denied' })
    expect(h.spawned()).toBe(0)
    expect(h.prompts.map(p => [p.action, p.device, p.target])).toEqual([
      ['avd_start', 'Pixel_8_API_36', 'Pixel_8_API_36'],
      ['apk_install', 'emulator-5554', APK],
      ['app_launch', 'emulator-5554', 'com.example.app'],
    ])
    expect(h.audit.map(e => [e.action, e.outcome])).toEqual([['avd_start', 'denied'], ['apk_install', 'denied'], ['app_launch', 'denied']])
  })

  test('approved, each runs its fixed command with no shell and its own timeout, and is audited', async () => {
    const h = harness({ approve: true })
    expect(await h.lifecycle.avdStart({ avdName: 'Pixel_8_API_36' })).toEqual({ ok: true })
    expect(await h.lifecycle.apkInstall({ serial: 'emulator-5554', apkPath: APK, workspaceRoot: WORKSPACE })).toEqual({ ok: true })
    expect(await h.lifecycle.appLaunch({ serial: 'emulator-5554', packageName: 'com.example.app' })).toEqual({ ok: true })
    expect(h.emulatorCalls).toContainEqual(['-avd', 'Pixel_8_API_36'])
    expect(h.adbCalls).toEqual([
      { args: ['-s', 'emulator-5554', 'install', '-r', APK], shell: false, timeoutMs: 120_000 },
      { args: ['-s', 'emulator-5554', 'shell', 'monkey', '-p', 'com.example.app', '-c', 'android.intent.category.LAUNCHER', '1'], shell: false, timeoutMs: 15_000 },
    ])
    expect(h.audit.map(e => [e.action, e.target, e.outcome])).toEqual([
      ['avd_start', 'Pixel_8_API_36', 'ok'],
      ['apk_install', APK, 'ok'],
      ['app_launch', 'com.example.app', 'ok'],
    ])
  })
})

describe('OXE-111 (A) · CA-2: logcat_tail is bounded and safe', () => {
  test('reads the last N lines (1 to 500, 100 by default) with -d and a 10 s timeout, never a free argument', async () => {
    const h = harness({ logcat: 'line\n' })
    await h.lifecycle.logcatTail({ serial: 'emulator-5554' })
    await h.lifecycle.logcatTail({ serial: 'emulator-5554', maxLines: 500 })
    expect(h.adbCalls).toEqual([
      { args: ['-s', 'emulator-5554', 'logcat', '-d', '-t', '100'], shell: false, timeoutMs: 10_000 },
      { args: ['-s', 'emulator-5554', 'logcat', '-d', '-t', '500'], shell: false, timeoutMs: 10_000 },
    ])
    for (const maxLines of [0, 501, 1.5]) {
      expect(await h.lifecycle.logcatTail({ serial: 'emulator-5554', maxLines })).toMatchObject({ ok: false, code: 'android.lifecycle.invalid', field: 'maxLines' })
    }
  })

  test('the output is at most 64 KB, cut deterministically to its last whole lines, and filtered by package or tag', async () => {
    const lines = Array.from({ length: 500 }, (_, i) => `11-23 10:00:00.${String(i).padStart(3, '0')} I ${i % 2 ? 'OkHttp' : 'com.example.app'}: ${'x'.repeat(200)}`)
    const h = harness({ logcat: lines.join('\n') + '\n' })
    const all = await h.lifecycle.logcatTail({ serial: 'emulator-5554', maxLines: 500 })
    expect(all.ok).toBe(true)
    const text = all.ok ? all.output ?? '' : ''
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(64 * 1024)
    expect(text.endsWith(lines[499])).toBe(true)
    expect(text.split('\n')[0]).toMatch(/^11-23 /)
    const filtered = await h.lifecycle.logcatTail({ serial: 'emulator-5554', maxLines: 500, tag: 'OkHttp' })
    expect(filtered.ok && filtered.output?.split('\n').every(line => line.includes('OkHttp'))).toBe(true)
  })

  test('a device the person has not shared with agents is refused before adb runs', async () => {
    const h = harness({ visible: false })
    expect(await h.lifecycle.logcatTail({ serial: 'emulator-5554' })).toEqual({ ok: false, code: 'android.agents.notAllowed' })
    expect(h.adbCalls).toEqual([])
  })
})

describe('OXE-111 (A) · CA-3: unsafe input is refused before approval or any process', () => {
  test('an APK outside the workspace, a package with ; | &, or an AVD that is not installed', async () => {
    const h = harness({ approve: true })
    expect(await h.lifecycle.apkInstall({ serial: 'emulator-5554', apkPath: OUTSIDE, workspaceRoot: WORKSPACE })).toMatchObject({ ok: false, code: 'android.lifecycle.invalid', field: 'apkPath' })
    expect(await h.lifecycle.apkInstall({ serial: 'emulator-5554', apkPath: APK.replace(/\.apk$/, '.sh'), workspaceRoot: WORKSPACE })).toMatchObject({ ok: false, code: 'android.lifecycle.invalid', field: 'apkPath' })
    for (const packageName of ['com.example;reboot', 'com.example|sh', 'com.example&&x', '-p', 'nodots']) {
      expect(await h.lifecycle.appLaunch({ serial: 'emulator-5554', packageName })).toMatchObject({ ok: false, code: 'android.lifecycle.invalid', field: 'packageName' })
    }
    expect(await h.lifecycle.avdStart({ avdName: 'Not_Installed' })).toMatchObject({ ok: false, code: 'android.lifecycle.invalid', field: 'avdName' })
    expect(await h.lifecycle.avdStart({ avdName: '-wipe-data' })).toMatchObject({ ok: false, code: 'android.lifecycle.invalid', field: 'avdName' })
    expect(await h.lifecycle.appLaunch({ serial: '-s', packageName: 'com.example.app' })).toMatchObject({ ok: false, code: 'android.lifecycle.invalid', field: 'serial' })
    expect(await h.lifecycle.logcatTail({ serial: 'emulator-5554', tag: 'a b;c' })).toMatchObject({ ok: false, code: 'android.lifecycle.invalid', field: 'tag' })
    expect(h.prompts).toEqual([])
    expect(h.spawned()).toBe(0)
  })
})
