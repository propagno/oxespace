import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * scripts/android/avd-rc-pass.sh keeps the team's memory floor (docs/validation/mobile-avd-rc-pass.md): no boot under
 * 4 GB free. RC_FAKE_FREE_MB stands in for the machine's memory, and the SDK points nowhere, so no emulator or adb can
 * start whatever happens.
 */
const hasSh = spawnSync('sh', ['-c', 'exit 0']).status === 0
let root: string

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'oxe-rc-')) })
afterEach(() => rmSync(root, { recursive: true, force: true }))

function run(phase: string, freeMb: number) {
  const env = { PATH: process.env.PATH ?? '', RC_ROOT: join(root, 'rc'), OUT: join(root, 'out'), RC_FAKE_FREE_MB: String(freeMb), ANDROID_SDK_ROOT: join(root, 'no-sdk'), APK: join(root, 'none.apk') }
  return spawnSync('sh', [join('scripts', 'android', 'avd-rc-pass.sh'), phase], { env, encoding: 'utf8', timeout: 20_000 })
}

describe.runIf(hasSh)('avd-rc-pass.sh memory floor', () => {
  it('preflight passes with 4 GB free and touches no emulator', () => {
    const result = run('preflight', 5000)
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/memory: ok \(5000 MB free\)/)
    expect(existsSync(join(root, 'out', 'emulator.log'))).toBe(false)
  })

  it('refuses to boot with less than 4 GB free, and says why in fail.txt', () => {
    for (const phase of ['preflight', 'pair', 'script']) {
      const result = run(phase, 3000)
      expect(result.status, phase).toBe(1)
      expect(readFileSync(join(root, 'rc', 'fail.txt'), 'utf8')).toMatch(/^memory: 3000 MB free, 4096 MB needed/)
      expect(existsSync(join(root, 'out', 'emulator.log')), phase).toBe(false)
    }
  })

  it('fails the boot step at once when there is no device, instead of waiting for one forever', () => {
    const started = Date.now()
    const result = run('pair', 5000)
    expect(result.status).toBe(1)
    expect(readFileSync(join(root, 'rc', 'fail.txt'), 'utf8')).toMatch(/^boot: no device/)
    expect(existsSync(join(root, 'rc', 'avd-ready'))).toBe(false)
    expect(Date.now() - started).toBeLessThan(15_000)
  })

  it('rejects an unknown phase', () => {
    expect(run('boot', 5000).status).toBe(2)
  })
})

/**
 * A fake SDK: `adb` logs its arguments and serves one UI dump of a camera permission dialog; `emulator` does nothing;
 * `sleep` on the PATH returns at once. Nothing real starts.
 */
const DUMP = [
  '<node text="Allow OXESpace to take pictures and record video?" resource-id="com.android.permissioncontroller:id/permission_message" bounds="[0,100][1000,200]" />',
  '<node text="While using the app" resource-id="com.android.permissioncontroller:id/permission_allow_foreground_only_button" bounds="[0,300][1000,400]" />',
  '<node text="Allow" resource-id="com.android.permissioncontroller:id/permission_allow_button" bounds="[100,500][300,600]" />',
  '<node text="Don’t allow" resource-id="com.android.permissioncontroller:id/permission_deny_button" bounds="[100,700][300,800]" />',
  '<node text="C9BNW5" bounds="[0,0][10,10]" /><node text="Conversations" bounds="[0,0][10,10]" />'
].join('')

/** A path with forward slashes: what Git Bash's cygpath -m gives, and what sh reads on every platform. */
const fwd = (path: string) => path.split(sep).join('/')

function fakeSdk() {
  const sdk = join(root, 'sdk'), bin = join(root, 'bin')
  for (const dir of [join(sdk, 'platform-tools'), join(sdk, 'emulator'), bin]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(root, 'dump.xml'), DUMP)
  const adb = [
    '#!/bin/sh',
    `echo "$*" >> '${fwd(join(root, 'adb.log'))}'`,
    'case "$*" in',
    '  "shell getprop sys.boot_completed") echo 1 ;;',
    `  "exec-out cat /sdcard/ui.xml") cat '${fwd(join(root, 'dump.xml'))}' ;;`,
    'esac',
    'exit 0'
  ].join('\n')
  writeFileSync(join(sdk, 'platform-tools', 'adb'), adb, { mode: 0o755 })
  writeFileSync(join(sdk, 'emulator', 'emulator'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  return { sdk, bin }
}

/**
 * A pass on the fake device starts a few dozen sh and adb processes. Git Bash on the Windows runners takes 8–18 s for
 * that, past vitest's 5 s default, so these tests get their own budget.
 */
const FAKE_RUN_MS = 50_000

function runFake(phase: string, extra: Record<string, string>) {
  const { sdk, bin } = fakeSdk()
  const env = { PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, RC_ROOT: join(root, 'rc'), OUT: join(root, 'out'), RC_FAKE_FREE_MB: '5000', ANDROID_SDK_ROOT: sdk, ...extra }
  return spawnSync('sh', [join('scripts', 'android', 'avd-rc-pass.sh'), phase], { env, encoding: 'utf8', timeout: FAKE_RUN_MS })
}
const taps = () => readFileSync(join(root, 'adb.log'), 'utf8').split('\n').filter(line => line.startsWith('shell input tap '))

describe.runIf(hasSh)('avd-rc-pass.sh steps on a fake device', { timeout: FAKE_RUN_MS + 10_000 }, () => {
  it('tapid taps the permission button by its id, where tap Allow would hit the dialog title', () => {
    writeFileSync(join(root, 'steps.txt'), 'tap Allow\ntapid permission_allow_button\ntapid? not_on_screen\n')
    const result = runFake('script', { STEPS: join(root, 'steps.txt') })
    expect(result.status, result.stderr).toBe(0)
    expect(taps()).toEqual(['shell input tap 500 150', 'shell input tap 200 550'])
    expect(existsSync(join(root, 'rc', 'done-script'))).toBe(true)
  })

  it('a tapid with no such id fails the step and says which', () => {
    writeFileSync(join(root, 'steps.txt'), 'tapid permission_allow_always_button\n')
    expect(runFake('script', { STEPS: join(root, 'steps.txt') }).status).toBe(1)
    expect(readFileSync(join(root, 'rc', 'fail.txt'), 'utf8')).toMatch(/^step 1: no id 'permission_allow_always_button' on screen/)
  })

  it('hands adb the APK path in the form adb reads (C:/… under Git Bash)', () => {
    mkdirSync(join(root, 'rc'), { recursive: true })
    writeFileSync(join(root, 'rc', 'pair-link.txt'), 'oxespace://pair?v=1&host=10.0.2.2&port=1&fp=x&code=y\n')
    const apk = join(root, 'app.apk')
    const shPath = spawnSync('sh', ['-c', 'command -v cygpath > /dev/null && cygpath -u "$1" || printf %s "$1"', 'sh', apk], { encoding: 'utf8' }).stdout.trim()
    const result = runFake('pair', { APK: shPath })
    expect(result.status, result.stderr).toBe(0)
    const install = readFileSync(join(root, 'adb.log'), 'utf8').split('\n').find(line => line.startsWith('install -r '))
    expect(install).toBe(`install -r ${fwd(apk)}`)
  })
})
