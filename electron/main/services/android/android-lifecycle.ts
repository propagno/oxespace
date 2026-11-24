import { isAbsolute, relative, resolve } from 'node:path'
import { installFailure } from '../../../../shared/android-actions'
import { assertValidSerial, isApkPath, type AdbResult, type AdbRunner, type AndroidDevices } from './android-devices'

/**
 * The Android lifecycle operations agents call through MCP: start an AVD, install an APK from the workspace, launch an
 * app, read the end of logcat. Every input is checked here, before the person is asked or any process starts; the
 * three that change a device ask the person first, showing the action, the device and the exact target, and run
 * nothing when refused. Each command is a fixed argument list (no shell) with its own timeout.
 */

export type LifecycleAction = 'avd_start' | 'apk_install' | 'app_launch' | 'logcat_tail'

/** What the person is shown before a device changes. */
export interface LifecyclePrompt {
  action: Exclude<LifecycleAction, 'logcat_tail'>
  device: string
  target: string
}

export interface LifecycleAuditEntry {
  action: LifecycleAction
  device: string
  target: string
  outcome: 'ok' | 'denied' | 'failed'
}

export type LifecycleResult =
  | { ok: true; serial?: string; output?: string; truncated?: boolean }
  | { ok: false; code: 'android.lifecycle.invalid'; field: string }
  | { ok: false; code: 'android.lifecycle.denied' | 'android.agents.notAllowed' }
  | { ok: false; code: 'android.lifecycle.failed'; reason: string }

const AVD_BOOT_TIMEOUT_MS = 60_000
const AVD_BOOT_POLL_MS = 1_000
const AVD_BOOT_PROBE_TIMEOUT_MS = 5_000
const APK_INSTALL_TIMEOUT_MS = 120_000
const APP_LAUNCH_TIMEOUT_MS = 15_000
const LOGCAT_TIMEOUT_MS = 10_000
const LOGCAT_DEFAULT_LINES = 100
const LOGCAT_MAX_LINES = 500
const LOGCAT_MAX_BYTES = 64 * 1024

const AVD_NAME_RE = /^[A-Za-z0-9._-]{1,128}$/
/** An Android application id: dot-separated words, letters, digits and `_` only. */
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/
const TAG_RE = /^[A-Za-z0-9._-]{1,64}$/
const PID_RE = /^\d{1,10}$/

function invalid(field: string): LifecycleResult {
  return { ok: false, code: 'android.lifecycle.invalid', field }
}

function validSerial(serial: unknown): serial is string {
  if (typeof serial !== 'string') return false
  try {
    assertValidSerial(serial)
    return true
  } catch {
    return false
  }
}

function validPackage(name: unknown): name is string {
  return typeof name === 'string' && name.length <= 255 && PACKAGE_RE.test(name)
}

/** An APK inside the workspace: absolute, `.apk`, and still inside the workspace once `..` is resolved. */
export function isWorkspaceApk(apkPath: unknown, workspaceRoot: unknown): apkPath is string {
  if (!isApkPath(apkPath) || typeof workspaceRoot !== 'string' || !isAbsolute(workspaceRoot)) return false
  if (apkPath.split(/[\\/]/).includes('..')) return false
  const rel = relative(resolve(workspaceRoot), resolve(apkPath))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

function text(out: string | Buffer): string {
  return typeof out === 'string' ? out : out.toString('utf8')
}

/** The last whole lines that fit in `maxBytes`, oldest first; the cut is always at a line boundary. */
export function tailWithinBytes(lines: readonly string[], maxBytes: number): { output: string; truncated: boolean } {
  const kept: string[] = []
  let bytes = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const size = Buffer.byteLength(lines[i], 'utf8') + (kept.length > 0 ? 1 : 0)
    if (bytes + size > maxBytes) break
    kept.push(lines[i])
    bytes += size
  }
  kept.reverse()
  return { output: kept.join('\n'), truncated: kept.length < lines.length }
}

export class AndroidLifecycle {
  private readonly devices: AndroidDevices
  private readonly run: AdbRunner
  private readonly approve: (prompt: LifecyclePrompt) => Promise<boolean>
  private readonly agentsCanSee: (serial: string) => boolean
  private readonly audit?: { record(entry: LifecycleAuditEntry): void }
  private readonly bootTimeoutMs: number
  private readonly bootPollMs: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number

  constructor(options: {
    devices: AndroidDevices
    run: AdbRunner
    approve: (prompt: LifecyclePrompt) => Promise<boolean>
    agentsCanSee: (serial: string) => boolean
    audit?: { record(entry: LifecycleAuditEntry): void }
    bootTimeoutMs?: number
    bootPollMs?: number
    sleep?: (ms: number) => Promise<void>
    now?: () => number
  }) {
    this.devices = options.devices
    this.run = options.run
    this.approve = options.approve
    this.agentsCanSee = options.agentsCanSee
    this.audit = options.audit
    this.bootTimeoutMs = options.bootTimeoutMs ?? AVD_BOOT_TIMEOUT_MS
    this.bootPollMs = options.bootPollMs ?? AVD_BOOT_POLL_MS
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
    this.now = options.now ?? (() => Date.now())
  }

  async avdStart(input: { avdName: unknown }): Promise<LifecycleResult> {
    const avd = input.avdName
    if (typeof avd !== 'string' || !AVD_NAME_RE.test(avd) || avd.startsWith('-')) return invalid('avdName')
    if (!(await this.devices.listAvds()).includes(avd)) return invalid('avdName')
    let bootedSerial: string | undefined
    const res = await this.changeDevice({ action: 'avd_start', device: avd, target: avd }, async () => {
      const before = new Set(await this.devices.ownedSerials())
      try {
        await this.devices.startAvd(avd)
      } catch (err) {
        return err instanceof Error ? err.message : 'Failed to start Android emulator'
      }
      const boot = await this.waitForBoot(avd, before)
      if ('error' in boot) return boot.error
      bootedSerial = boot.serial
      return null
    })
    return res.ok && bootedSerial ? { ok: true, serial: bootedSerial } : res
  }

  private async waitForBoot(avd: string, before: ReadonlySet<string>): Promise<{ serial: string } | { error: string }> {
    const deadline = this.now() + this.bootTimeoutMs
    while (true) {
      const owned = await this.devices.ownedSerials()
      const serial = owned.find(candidate => !before.has(candidate))
      if (serial) {
        const prop = await this.adb(['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], AVD_BOOT_PROBE_TIMEOUT_MS)
        if (prop.missing) return { error: 'adb not found' }
        if (prop.status === 0 && text(prop.stdout).trim() === '1') return { serial }
      }
      const remaining = deadline - this.now()
      if (remaining <= 0) {
        const seconds = Math.max(1, Math.round(this.bootTimeoutMs / 1000))
        return { error: `Emulator "${avd}" did not finish booting within ${seconds}s` }
      }
      await this.sleep(Math.min(this.bootPollMs, remaining))
    }
  }

  async apkInstall(input: { serial: unknown; apkPath: unknown; workspaceRoot: unknown }): Promise<LifecycleResult> {
    const { serial, apkPath } = input
    if (!validSerial(serial)) return invalid('serial')
    if (!isWorkspaceApk(apkPath, input.workspaceRoot)) return invalid('apkPath')
    if (!this.agentsCanSee(serial)) return { ok: false, code: 'android.agents.notAllowed' }
    return this.changeDevice({ action: 'apk_install', device: serial, target: apkPath }, async () => {
      const res = await this.adb(['-s', serial, 'install', '-r', apkPath], APK_INSTALL_TIMEOUT_MS)
      if (res.missing) return 'adb not found'
      const reason = installFailure(`${text(res.stdout)}\n${res.stderr}`)
      return reason === null && res.status === 0 ? null : reason ?? `adb exited with ${res.status ?? 'no status'}`
    })
  }

  async appLaunch(input: { serial: unknown; packageName: unknown }): Promise<LifecycleResult> {
    const { serial, packageName } = input
    if (!validSerial(serial)) return invalid('serial')
    if (!validPackage(packageName)) return invalid('packageName')
    if (!this.agentsCanSee(serial)) return { ok: false, code: 'android.agents.notAllowed' }
    return this.changeDevice({ action: 'app_launch', device: serial, target: packageName }, async () => {
      const res = await this.adb(
        ['-s', serial, 'shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'],
        APP_LAUNCH_TIMEOUT_MS
      )
      if (res.missing) return 'adb not found'
      const out = `${text(res.stdout)}\n${res.stderr}`
      return res.status === 0 && /Events injected: 1\b/.test(out) ? null : /monkey aborted/i.test(out) ? 'No launchable activity' : `adb exited with ${res.status ?? 'no status'}`
    })
  }

  /** The last `maxLines` lines of the device log (1 to 500, 100 by default), at most 64 KB, optionally one app's or one tag's. */
  async logcatTail(input: { serial: unknown; maxLines?: unknown; packageName?: unknown; tag?: unknown }): Promise<LifecycleResult> {
    const { serial } = input
    if (!validSerial(serial)) return invalid('serial')
    const maxLines = input.maxLines ?? LOGCAT_DEFAULT_LINES
    if (typeof maxLines !== 'number' || !Number.isInteger(maxLines) || maxLines < 1 || maxLines > LOGCAT_MAX_LINES) return invalid('maxLines')
    if (input.packageName !== undefined && !validPackage(input.packageName)) return invalid('packageName')
    if (input.tag !== undefined && (typeof input.tag !== 'string' || !TAG_RE.test(input.tag))) return invalid('tag')
    if (!this.agentsCanSee(serial)) return { ok: false, code: 'android.agents.notAllowed' }

    const args = ['-s', serial, 'logcat', '-d', '-t', String(maxLines)]
    if (typeof input.packageName === 'string') {
      const pid = await this.adb(['-s', serial, 'shell', 'pidof', input.packageName], LOGCAT_TIMEOUT_MS)
      const found = text(pid.stdout).trim().split(/\s+/)[0] ?? ''
      if (pid.missing) return this.failed('logcat_tail', serial, input.packageName, 'adb not found')
      if (pid.status !== 0 || !PID_RE.test(found)) return { ok: true, output: '', truncated: false }
      args.push(`--pid=${found}`)
    }
    const res = await this.adb(args, LOGCAT_TIMEOUT_MS)
    const target = typeof input.packageName === 'string' ? input.packageName : typeof input.tag === 'string' ? input.tag : 'logcat'
    if (res.missing) return this.failed('logcat_tail', serial, target, 'adb not found')
    if (res.status !== 0) return this.failed('logcat_tail', serial, target, `adb exited with ${res.status ?? 'no status'}`)

    let lines = text(res.stdout).split(/\r?\n/).filter(line => line.length > 0)
    if (typeof input.tag === 'string') {
      const marker = ` ${input.tag}:`
      const markerPadded = ` ${input.tag} `
      lines = lines.filter(line => line.includes(marker) || line.includes(markerPadded))
    }
    const tail = tailWithinBytes(lines.slice(-maxLines), LOGCAT_MAX_BYTES)
    this.audit?.record({ action: 'logcat_tail', device: serial, target, outcome: 'ok' })
    return { ok: true, ...tail }
  }

  private adb(args: string[], timeoutMs: number): Promise<AdbResult> {
    return this.run(args, { shell: false, timeoutMs })
  }

  private failed(action: LifecycleAction, device: string, target: string, reason: string): LifecycleResult {
    this.audit?.record({ action, device, target, outcome: 'failed' })
    return { ok: false, code: 'android.lifecycle.failed', reason }
  }

  /** Asks the person, then runs `act` (which returns null when it worked, or why it did not). Refused: nothing runs. */
  private async changeDevice(prompt: LifecyclePrompt, act: () => Promise<string | null>): Promise<LifecycleResult> {
    if (!(await this.approve(prompt))) {
      this.audit?.record({ ...prompt, outcome: 'denied' })
      return { ok: false, code: 'android.lifecycle.denied' }
    }
    const reason = await act()
    if (reason !== null) return this.failed(prompt.action, prompt.device, prompt.target, reason)
    this.audit?.record({ ...prompt, outcome: 'ok' })
    return { ok: true }
  }
}
