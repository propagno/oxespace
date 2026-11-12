import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import {
  OXESPACE_PHONE_ACTIVITY, OXESPACE_PHONE_PACKAGE, PAIR_LINK_EXTRA, deviceLinkRefusal, installFailure, isPairLink, phoneAppBuild, quotedForDeviceShell, startFailure,
  type PhoneAppBuild
} from '../../../../shared/android-actions'

export interface AdbResult {
  status: number | null
  stdout: string | Buffer
  stderr: string
  missing?: boolean
}

export type AdbRunner = (args: string[], opts?: { shell?: boolean; timeoutMs?: number }) => Promise<AdbResult>
export type EmulatorRunner = (args: string[], opts?: { detached?: boolean }) => Promise<AdbResult>

export type AndroidDeviceKind = 'emulator' | 'usb' | 'wifi'
export type AndroidDeviceState =
  | 'device'
  | 'offline'
  | 'unauthorized'
  | 'recovery'
  | 'sideload'
  | 'authorizing'
  | 'no-permissions'

export interface AndroidDeviceSummary {
  serial: string
  name: string
  kind: AndroidDeviceKind
  api?: number
  state: AndroidDeviceState
}

export interface AndroidListResult {
  adb: 'missing' | 'ok'
  devices: AndroidDeviceSummary[]
}

export interface AndroidDisplaySize {
  width: number
  height: number
}

export interface AndroidAuditEntry {
  action: 'android-agents-can-see'
  target: string
  outcome: 'on' | 'off'
}

/** What the person had a device do from the panel: an APK installed, a web address opened, the pairing link sent. */
export type AndroidPersonAction = 'android-install-apk' | 'android-open-link' | 'android-pair-link'
/** How one of those ended: done, or the reason the device gave. */
export type AndroidActionResult = { ok: true } | { ok: false; reason: string }
/** An install takes as long as the file is large: far longer than a tap. */
const INSTALL_TIMEOUT_MS = 180_000

/** An APK on this computer as adb takes it: a full path to a `.apk`, nothing adb could read as an option. */
export function isApkPath(path: unknown): path is string {
  return typeof path === 'string' && path.length <= 1024 && !path.startsWith('-') && isAbsolute(path) && /\.apk$/i.test(path) && !/[\x00-\x1f\x7f]/.test(path)
}

export interface AndroidAuditSink {
  record(entry: AndroidAuditEntry): void
}

const SERIAL_RE = /^[A-Za-z0-9._:-]+$/
const AVD_NAME_RE = /^[A-Za-z0-9._-]+$/
const NON_NEGATIVE_INT_RE = /^\d+$/
const KNOWN_STATES = new Set<AndroidDeviceState>([
  'device',
  'offline',
  'unauthorized',
  'recovery',
  'sideload',
  'authorizing'
])

export function assertValidSerial(serial: string): void {
  if (!serial || serial.startsWith('-') || !SERIAL_RE.test(serial)) {
    throw new Error('Invalid Android device serial')
  }
}

function isAllowedAdbArgs(args: readonly string[]): boolean {
  if (args.length === 2 && args[0] === 'devices' && args[1] === '-l') return true
  if (args.length < 5 || args[0] !== '-s') return false
  const serial = args[1]
  if (!serial || serial.startsWith('-') || !SERIAL_RE.test(serial)) return false
  if (args.length === 5 && args[2] === 'shell' && args[3] === 'getprop' && args[4] === 'ro.build.version.sdk') return true
  if (args.length === 5 && args[2] === 'shell' && args[3] === 'wm' && args[4] === 'size') return true
  if (args.length === 5 && args[2] === 'exec-out' && args[3] === 'screencap' && args[4] === '-p') return true
  if (
    args.length === 7 &&
    args[2] === 'shell' &&
    args[3] === 'input' &&
    args[4] === 'tap' &&
    NON_NEGATIVE_INT_RE.test(args[5]) &&
    NON_NEGATIVE_INT_RE.test(args[6])
  ) {
    return true
  }
  if (
    args.length === 10 &&
    args[2] === 'shell' &&
    args[3] === 'input' &&
    args[4] === 'swipe' &&
    NON_NEGATIVE_INT_RE.test(args[5]) &&
    NON_NEGATIVE_INT_RE.test(args[6]) &&
    NON_NEGATIVE_INT_RE.test(args[7]) &&
    NON_NEGATIVE_INT_RE.test(args[8]) &&
    NON_NEGATIVE_INT_RE.test(args[9])
  ) {
    return true
  }
  if (
    args.length === 6 &&
    args[2] === 'shell' &&
    args[3] === 'input' &&
    args[4] === 'keyevent' &&
    NON_NEGATIVE_INT_RE.test(args[5])
  ) {
    return true
  }
  // The person's own actions from the panel, each in one fixed shape. Nothing else installs or starts anything.
  if (args.length === 5 && args[2] === 'install' && args[3] === '-r' && isApkPath(args[4])) return true
  if (args.length === 6 && args[2] === 'shell' && args[3] === 'dumpsys' && args[4] === 'package' && args[5] === OXESPACE_PHONE_PACKAGE) return true
  // `am start` only in two shapes, each ending in one single-quoted word the device's shell reads literally.
  const quoted = (word: string | undefined): string | null => word && word.length > 2 && word.startsWith("'") && word.endsWith("'") ? word.slice(1, -1) : null
  if (args.length === 9 && args[2] === 'shell' && args[3] === 'am' && args[4] === 'start' && args[5] === '-a' && args[6] === 'android.intent.action.VIEW' && args[7] === '-d') {
    return deviceLinkRefusal(quoted(args[8])) === null
  }
  if (args.length === 10 && args[2] === 'shell' && args[3] === 'am' && args[4] === 'start' && args[5] === '-n' && args[6] === OXESPACE_PHONE_ACTIVITY && args[7] === '--es' && args[8] === PAIR_LINK_EXTRA) {
    return isPairLink(quoted(args[9]))
  }
  return false
}

/** Where the SDK is: the folder the person named, else the one Android Studio installs to. */
function sdkRoots(): string[] {
  const named = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].map(value => value?.trim()).filter((value): value is string => Boolean(value))
  const home = homedir()
  const usual = process.platform === 'win32' ? (process.env.LOCALAPPDATA?.trim() ? join(process.env.LOCALAPPDATA.trim(), 'Android', 'Sdk') : join(home, 'AppData', 'Local', 'Android', 'Sdk'))
    : process.platform === 'darwin' ? join(home, 'Library', 'Android', 'sdk')
    : join(home, 'Android', 'Sdk')
  return [...new Set([...named, usual])]
}

/** The tool inside an SDK that is on this computer: the first that exists, or null. Nothing is downloaded. */
function sdkToolCandidate(folder: string, binary: string): string | null {
  const ext = process.platform === 'win32' ? '.exe' : ''
  return sdkRoots().map(root => join(root, folder, `${binary}${ext}`)).find(path => existsSync(path)) ?? null
}

function spawnBinary(binary: string, args: string[], timeoutMs = 15_000, detached = false): Promise<AdbResult> {
  return new Promise(resolve => {
    if (detached) {
      let settled = false
      const child = spawn(binary, args, { shell: false, windowsHide: true, detached: true, stdio: 'ignore' })
      child.once('error', (err: NodeJS.ErrnoException) => {
        if (settled) return
        settled = true
        if (err.code === 'ENOENT') resolve({ status: null, stdout: '', stderr: '', missing: true })
        else resolve({ status: 1, stdout: '', stderr: err.message })
      })
      child.once('spawn', () => {
        if (settled) return
        settled = true
        child.unref()
        resolve({ status: 0, stdout: '', stderr: '' })
      })
      return
    }

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false
    const child = spawn(binary, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve({ status: null, stdout: Buffer.concat(stdoutChunks), stderr: 'adb timed out' })
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => { stdoutChunks.push(chunk) })
    child.stderr?.on('data', (chunk: Buffer) => { stderrChunks.push(chunk) })
    child.once('error', (err: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err.code === 'ENOENT') resolve({ status: null, stdout: '', stderr: '', missing: true })
      else resolve({ status: 1, stdout: '', stderr: err.message })
    })
    child.once('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        status: code,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks).toString('utf8')
      })
    })
  })
}

export const defaultAdbRunner: AdbRunner = async (args, opts) => {
  const primary = await spawnBinary('adb', args, opts?.timeoutMs)
  if (!primary.missing) return primary
  const fallback = sdkToolCandidate('platform-tools', 'adb')
  if (!fallback) return primary
  return spawnBinary(fallback, args, opts?.timeoutMs)
}

export const defaultEmulatorRunner: EmulatorRunner = async (args, opts) => {
  const primary = await spawnBinary('emulator', args, 10_000, opts?.detached === true)
  if (!primary.missing) return primary
  const fallback = sdkToolCandidate('emulator', 'emulator')
  if (!fallback) return primary
  return spawnBinary(fallback, args, 10_000, opts?.detached === true)
}

function stdoutText(stdout: string | Buffer): string {
  const raw = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : stdout
  return raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function classifyKind(serial: string): AndroidDeviceKind {
  if (/^emulator-\d+$/.test(serial)) return 'emulator'
  if (serial.includes(':') || serial.includes('._adb-tls-connect._tcp')) return 'wifi'
  return 'usb'
}

function parseState(rest: string): AndroidDeviceState | null {
  if (rest.startsWith('no permissions')) return 'no-permissions'
  const word = rest.split(/\s+/)[0] ?? ''
  if (KNOWN_STATES.has(word as AndroidDeviceState)) return word as AndroidDeviceState
  return null
}

function toNonNegativeIntString(value: number, field: string): string {
  if (!Number.isFinite(value)) throw new Error(`Invalid Android coordinate: ${field}`)
  const rounded = Math.max(0, Math.round(value))
  return String(rounded)
}

export class AndroidDevices {
  private readonly run: AdbRunner
  private readonly runEmulator: EmulatorRunner

  constructor(options: { run?: AdbRunner; runEmulator?: EmulatorRunner } = {}) {
    this.run = options.run ?? defaultAdbRunner
    this.runEmulator = options.runEmulator ?? defaultEmulatorRunner
  }

  async adb(args: readonly string[], timeoutMs?: number): Promise<AdbResult> {
    if (!isAllowedAdbArgs(args)) {
      throw new Error(`Refused adb command outside allowlist: ${args[0] ?? '<empty>'}`)
    }
    return this.run([...args], timeoutMs ? { shell: false, timeoutMs } : { shell: false })
  }

  /** Installs (or replaces) an app from an APK on this computer. The path is the one the person picked, never a guess. */
  async installApk(serial: string, apkPath: string): Promise<AndroidActionResult> {
    assertValidSerial(serial)
    if (!isApkPath(apkPath)) throw new Error('Invalid APK path')
    const res = await this.adb(['-s', serial, 'install', '-r', apkPath], INSTALL_TIMEOUT_MS)
    if (res.missing) return { ok: false, reason: 'adb not found' }
    const reason = installFailure(`${stdoutText(res.stdout)}\n${res.stderr}`)
    return reason === null && res.status === 0 ? { ok: true } : { ok: false, reason: reason ?? `adb exited with ${res.status ?? 'no status'}` }
  }

  /** Opens a web address in the device's browser. The address is checked here, whoever called. */
  async openLink(serial: string, url: string): Promise<AndroidActionResult> {
    assertValidSerial(serial)
    const refusal = deviceLinkRefusal(url)
    if (refusal) throw new Error(`Refused link: ${refusal}`)
    return this.started(await this.adb(['-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', quotedForDeviceShell(url)]))
  }

  /** Hands the desktop's pairing link to the phone app, as the QR would. A debug build reads it; a release ignores it. */
  async sendPairLink(serial: string, link: string): Promise<AndroidActionResult> {
    assertValidSerial(serial)
    if (!isPairLink(link)) throw new Error('Refused pairing link')
    return this.started(await this.adb(['-s', serial, 'shell', 'am', 'start', '-n', OXESPACE_PHONE_ACTIVITY, '--es', PAIR_LINK_EXTRA, quotedForDeviceShell(link)]))
  }

  /** Whether the phone app is on the device, and which build: the pairing link is only offered to a debug one. */
  async phoneApp(serial: string): Promise<PhoneAppBuild> {
    assertValidSerial(serial)
    const res = await this.adb(['-s', serial, 'shell', 'dumpsys', 'package', OXESPACE_PHONE_PACKAGE])
    if (res.missing || res.status !== 0) return 'absent'
    return phoneAppBuild(stdoutText(res.stdout))
  }

  private started(res: AdbResult): AndroidActionResult {
    if (res.missing) return { ok: false, reason: 'adb not found' }
    const reason = startFailure(`${stdoutText(res.stdout)}\n${res.stderr}`)
    return reason === null && res.status === 0 ? { ok: true } : { ok: false, reason: reason ?? `adb exited with ${res.status ?? 'no status'}` }
  }

  async list(): Promise<AndroidListResult> {
    const res = await this.adb(['devices', '-l'])
    if (res.missing) return { adb: 'missing', devices: [] }
    const lines = stdoutText(res.stdout).split('\n')
    const devices: AndroidDeviceSummary[] = []
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || line.startsWith('*') || /^list of devices attached$/i.test(line)) continue
      const match = /^(\S+)\s+(.+)$/.exec(line)
      if (!match) continue
      const serial = match[1]
      const rest = match[2].trim()
      if (!serial || serial.startsWith('-') || !SERIAL_RE.test(serial)) continue
      const state = parseState(rest)
      if (!state) continue
      const modelMatch = /\bmodel:(\S+)/.exec(rest)
      const name = modelMatch ? modelMatch[1].replace(/_/g, ' ') : serial
      const kind = classifyKind(serial)
      let api: number | undefined
      if (state === 'device') {
        const sdk = await this.adb(['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk'])
        if (!sdk.missing && sdk.status === 0) {
          const parsed = Number.parseInt(stdoutText(sdk.stdout).trim(), 10)
          if (Number.isFinite(parsed) && parsed > 0) api = parsed
        }
      }
      devices.push({
        serial,
        name,
        kind,
        ...(api !== undefined ? { api } : {}),
        state
      })
    }
    return { adb: 'ok', devices }
  }

  async size(serial: string): Promise<AndroidDisplaySize> {
    assertValidSerial(serial)
    const res = await this.adb(['-s', serial, 'shell', 'wm', 'size'])
    const text = stdoutText(res.stdout)
    const override = /Override size:\s*(\d+)x(\d+)/i.exec(text)
    const physical = /Physical size:\s*(\d+)x(\d+)/i.exec(text)
    const chosen = override ?? physical
    if (!chosen) throw new Error('Unable to determine Android display size')
    const width = Number.parseInt(chosen[1], 10)
    const height = Number.parseInt(chosen[2], 10)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error('Invalid Android display size')
    }
    return { width, height }
  }

  async tap(serial: string, point: { x: number; y: number }): Promise<void> {
    assertValidSerial(serial)
    await this.adb(['-s', serial, 'shell', 'input', 'tap', toNonNegativeIntString(point.x, 'x'), toNonNegativeIntString(point.y, 'y')])
  }

  async swipe(serial: string, input: { x1: number; y1: number; x2: number; y2: number; durationMs?: number }): Promise<void> {
    assertValidSerial(serial)
    await this.adb([
      '-s',
      serial,
      'shell',
      'input',
      'swipe',
      toNonNegativeIntString(input.x1, 'x1'),
      toNonNegativeIntString(input.y1, 'y1'),
      toNonNegativeIntString(input.x2, 'x2'),
      toNonNegativeIntString(input.y2, 'y2'),
      toNonNegativeIntString(input.durationMs ?? 200, 'durationMs')
    ])
  }

  async key(serial: string, input: { keyCode: number }): Promise<void> {
    assertValidSerial(serial)
    await this.adb(['-s', serial, 'shell', 'input', 'keyevent', toNonNegativeIntString(input.keyCode, 'keyCode')])
  }

  async screencap(serial: string): Promise<Buffer> {
    assertValidSerial(serial)
    const res = await this.adb(['-s', serial, 'exec-out', 'screencap', '-p'])
    if (res.missing || res.status !== 0) throw new Error('Android screencap failed')
    return Buffer.isBuffer(res.stdout) ? res.stdout : Buffer.from(res.stdout, 'binary')
  }

  async listAvds(): Promise<string[]> {
    const res = await this.runEmulator(['-list-avds'])
    if (res.missing || res.status !== 0) return []
    return stdoutText(res.stdout)
      .split('\n')
      .map(line => line.trim())
      .filter(line => Boolean(line) && !line.startsWith('-') && AVD_NAME_RE.test(line))
  }

  async startAvd(avd: string): Promise<void> {
    if (!avd || avd.startsWith('-') || !AVD_NAME_RE.test(avd)) {
      throw new Error('Invalid AVD name')
    }
    const available = await this.listAvds()
    if (!available.includes(avd)) {
      throw new Error('Unknown AVD name')
    }
    const res = await this.runEmulator(['-avd', avd], { detached: true })
    if (res.missing || res.status !== 0) {
      throw new Error('Failed to start Android emulator')
    }
  }
}

export function mapTap(
  point: { x: number; y: number },
  canvas: { width: number; height: number },
  device: { width: number; height: number }
): { x: number; y: number } | null {
  if (canvas.width <= 0 || canvas.height <= 0 || device.width <= 0 || device.height <= 0) return null
  if (point.x < 0 || point.y < 0 || point.x > canvas.width || point.y > canvas.height) return null
  const x = Math.min(device.width - 1, Math.max(0, Math.floor((point.x / canvas.width) * device.width)))
  const y = Math.min(device.height - 1, Math.max(0, Math.floor((point.y / canvas.height) * device.height)))
  return { x, y }
}

export type AndroidAgentScreenshotResult =
  | { ok: true; png: string }
  | { ok: false; code: 'android.agents.notAllowed' | 'android.agents.denied' }

export class AndroidAgentAccess {
  private readonly devices: AndroidDevices
  private readonly audit?: AndroidAuditSink
  private readonly onChanged?: (serial: string, allowed: boolean) => void
  private readonly allowed = new Set<string>()
  private readonly sessionGrants = new Set<string>()

  constructor(options: {
    devices: AndroidDevices
    tempDir?: string
    audit?: AndroidAuditSink
    initialAllowed?: Iterable<string>
    onChanged?: (serial: string, allowed: boolean) => void
  }) {
    this.devices = options.devices
    this.audit = options.audit
    this.onChanged = options.onChanged
    if (options.initialAllowed) {
      for (const serial of options.initialAllowed) {
        if (serial && !serial.startsWith('-') && SERIAL_RE.test(serial)) this.allowed.add(serial)
      }
    }
  }

  agentsCanSee(serial: string): boolean {
    return this.allowed.has(serial)
  }

  setAgentsCanSee(serial: string, on: boolean): void {
    assertValidSerial(serial)
    const current = this.allowed.has(serial)
    if (current === on) return
    if (on) {
      this.allowed.add(serial)
    } else {
      this.allowed.delete(serial)
      const suffix = `\0${serial}`
      for (const key of this.sessionGrants) {
        if (key.endsWith(suffix)) this.sessionGrants.delete(key)
      }
    }
    this.audit?.record({ action: 'android-agents-can-see', target: serial, outcome: on ? 'on' : 'off' })
    this.onChanged?.(serial, on)
  }

  revokeSession(sessionKey: string): void {
    const prefix = `${sessionKey}\0`
    for (const key of this.sessionGrants) {
      if (key.startsWith(prefix)) this.sessionGrants.delete(key)
    }
  }

  async screenshot(input: {
    serial: string
    sessionKey: string
    ask: (prompt: { serial: string; sessionKey: string }) => Promise<boolean>
  }): Promise<AndroidAgentScreenshotResult> {
    assertValidSerial(input.serial)
    if (!this.allowed.has(input.serial)) {
      return { ok: false, code: 'android.agents.notAllowed' }
    }
    const grantKey = `${input.sessionKey}\0${input.serial}`
    if (!this.sessionGrants.has(grantKey)) {
      const approved = await input.ask({ serial: input.serial, sessionKey: input.sessionKey })
      if (!approved) {
        return { ok: false, code: 'android.agents.denied' }
      }
      if (!this.allowed.has(input.serial)) {
        return { ok: false, code: 'android.agents.notAllowed' }
      }
      this.sessionGrants.add(grantKey)
    }
    const pngBuffer = await this.devices.screencap(input.serial)
    return { ok: true, png: pngBuffer.toString('base64') }
  }
}
