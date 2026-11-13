import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { deviceLinkRefusal, type PhoneAppBuild } from '../../../shared/android-actions'
import { IPC_CHANNELS, type AndroidActionOutcome, type AndroidApkPick, type AndroidMirrorDevice, type AndroidMirrorFrame, type AndroidMirrorStatus } from '../../../shared/types/ipc'
import { assertValidSerial, isApkPath, type AndroidAgentAccess, type AndroidDevices, type AndroidPersonAction } from '../services/android/android-devices'

export interface AndroidIpcDeps {
  devices: AndroidDevices
  access: AndroidAgentAccess
  picturesDir?: () => string
  /** The APK the person picks in the system's file dialog, or null when they cancel. The window never names a path. */
  pickApk?: (owner: BrowserWindow | null) => Promise<string | null>
  /** Opens pairing on this desktop and gives its link; rejects when phones may not connect yet. */
  startPairing?: () => Promise<{ uri: string; expiresAt: number }>
  /** One row per thing the person had a device do; `detail` never holds a full address, a path or the pairing link. */
  audit?: (entry: { action: AndroidPersonAction; target: string; outcome: 'ok' | 'error'; detail: string | null }) => void
}

/** How long a picked APK waits for the person's yes before it is forgotten. */
const PICK_TTL_MS = 5 * 60_000
/** How long what `dumpsys` said about the phone app is believed: the panel asks every few seconds. */
const PHONE_APP_TTL_MS = 20_000
const MAX_APK_BYTES = 2 * 1024 * 1024 * 1024

async function defaultPickApk(owner: BrowserWindow | null): Promise<string | null> {
  const options = { properties: ['openFile' as const], filters: [{ name: 'Android package', extensions: ['apk'] }] }
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0] ?? null
}

interface StreamState {
  state: 'connecting' | 'live'
  active: boolean
  rotated: boolean
  timer: ReturnType<typeof setTimeout> | null
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const STREAM_INTERVAL_MS = 250

function parsePngDimensions(png: Buffer): { width: number; height: number } | null {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIG)) return null
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

function broadcast(channel: string, payload?: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

export function registerAndroidIpc(deps: AndroidIpcDeps): void {
  const streams = new Map<string, StreamState>()
  const phoneApps = new Map<string, { build: PhoneAppBuild; at: number }>()
  let picked: { id: string; path: string; serial: string; sizeBytes: number; at: number } | null = null

  const phoneAppOn = async (serial: string): Promise<PhoneAppBuild> => {
    const known = phoneApps.get(serial)
    if (known && Date.now() - known.at < PHONE_APP_TTL_MS) return known.build
    const build = await deps.devices.phoneApp(serial).catch(() => 'absent' as const)
    phoneApps.set(serial, { build, at: Date.now() })
    return build
  }
  /** The device as adb lists it now, ready to take a command; a serial that only looks valid is not enough. */
  const readyDevice = async (value: unknown): Promise<{ serial: string; name: string }> => {
    const serial = String(value ?? '')
    assertValidSerial(serial)
    const device = (await deps.devices.list()).devices.find(each => each.serial === serial && each.state === 'device')
    if (!device) throw new Error('Android device is not connected')
    return { serial, name: device.name }
  }
  /** A regular `.apk` file of a sane size, read again each time: the file can change between the pick and the yes. */
  const apkSize = async (path: string): Promise<number | null> => {
    if (!isApkPath(path)) return null
    const stats = await lstat(path).catch(() => null)
    return stats && stats.isFile() && !stats.isSymbolicLink() && stats.size > 0 && stats.size <= MAX_APK_BYTES ? stats.size : null
  }
  const record = (action: AndroidPersonAction, serial: string, outcome: AndroidActionOutcome, detail: string | null): void => {
    try { deps.audit?.({ action, target: serial, outcome: outcome.ok ? 'ok' : 'error', detail: outcome.ok ? detail : outcome.reason.slice(0, 120) }) } catch { /* best-effort audit */ }
  }

  const stopStream = (serial: string): void => {
    const existing = streams.get(serial)
    if (!existing) return
    existing.active = false
    if (existing.timer) {
      clearTimeout(existing.timer)
      existing.timer = null
    }
    streams.delete(serial)
  }

  const stopAll = (): void => {
    for (const serial of [...streams.keys()]) stopStream(serial)
  }

  const buildStatus = async (): Promise<AndroidMirrorStatus> => {
    const [listed, avds] = await Promise.all([deps.devices.list(), deps.devices.listAvds()])
    const liveSerials = new Set(listed.devices.filter(device => device.state === 'device').map(device => device.serial))
    for (const serial of [...streams.keys()]) {
      if (!liveSerials.has(serial)) stopStream(serial)
    }
    const builds = await Promise.all(listed.devices.map(device => device.state === 'device' ? phoneAppOn(device.serial) : Promise.resolve(undefined)))
    const devices: AndroidMirrorDevice[] = listed.devices.map((device, index) => ({
      ...device,
      agentsCanSee: deps.access.agentsCanSee(device.serial),
      stream: device.state === 'device' ? (streams.get(device.serial)?.state ?? 'idle') : 'idle',
      ...(builds[index] ? { phoneApp: builds[index] } : {})
    }))
    return { adb: listed.adb, devices, avds }
  }

  const notifyChanged = (): void => {
    void buildStatus().then(next => broadcast(IPC_CHANNELS.android.changed, next)).catch(() => {
      broadcast(IPC_CHANNELS.android.changed)
    })
  }

  const captureFrame = async (serial: string, stream: StreamState): Promise<void> => {
    const png = await deps.devices.screencap(serial)
    if (!stream.active) return
    const parsed = parsePngDimensions(png) ?? (await deps.devices.size(serial).catch(() => ({ width: 1080, height: 2400 })))
    if (!stream.active) return
    const width = stream.rotated ? parsed.height : parsed.width
    const height = stream.rotated ? parsed.width : parsed.height
    const becameLive = stream.state !== 'live'
    stream.state = 'live'
    const frame: AndroidMirrorFrame = {
      serial,
      width,
      height,
      data: new Uint8Array(png.buffer, png.byteOffset, png.byteLength)
    }
    broadcast(IPC_CHANNELS.android.frame, frame)
    if (becameLive) notifyChanged()
  }

  const scheduleNext = (serial: string, stream: StreamState): void => {
    if (!stream.active) return
    const timer = setTimeout(() => {
      stream.timer = null
      if (!stream.active || !BrowserWindow.getAllWindows().some(window => !window.isDestroyed())) {
        stopStream(serial)
        return
      }
      void captureFrame(serial, stream)
        .catch(() => {
          if (!stream.active) return
          stopStream(serial)
          notifyChanged()
        })
        .finally(() => {
          if (stream.active) scheduleNext(serial, stream)
        })
    }, STREAM_INTERVAL_MS)
    timer.unref?.()
    stream.timer = timer
  }

  app.once('before-quit', stopAll)

  ipcMain.handle(IPC_CHANNELS.android.status, async () => buildStatus())

  ipcMain.handle(IPC_CHANNELS.android.connect, async (_event, input: { serial: string }) => {
    const serial = String(input?.serial ?? '')
    assertValidSerial(serial)
    const previousRotated = streams.get(serial)?.rotated ?? false
    stopStream(serial)
    const stream: StreamState = { state: 'connecting', active: true, rotated: previousRotated, timer: null }
    streams.set(serial, stream)
    notifyChanged()
    await captureFrame(serial, stream).catch(() => {})
    if (stream.active) scheduleNext(serial, stream)
    return { ok: true }
  })

  ipcMain.handle(IPC_CHANNELS.android.disconnect, async (_event, input: { serial: string }) => {
    const serial = String(input?.serial ?? '')
    assertValidSerial(serial)
    stopStream(serial)
    notifyChanged()
  })

  ipcMain.handle(IPC_CHANNELS.android.tap, async (_event, input: { serial: string; x: number; y: number }) => {
    await deps.devices.tap(String(input?.serial ?? ''), { x: Number(input?.x), y: Number(input?.y) })
  })

  ipcMain.handle(
    IPC_CHANNELS.android.swipe,
    async (_event, input: { serial: string; x1: number; y1: number; x2: number; y2: number; durationMs?: number }) => {
      await deps.devices.swipe(String(input?.serial ?? ''), {
        x1: Number(input?.x1),
        y1: Number(input?.y1),
        x2: Number(input?.x2),
        y2: Number(input?.y2),
        ...(input?.durationMs !== undefined ? { durationMs: Number(input.durationMs) } : {})
      })
    }
  )

  ipcMain.handle(IPC_CHANNELS.android.key, async (_event, input: { serial: string; keycode: number }) => {
    await deps.devices.key(String(input?.serial ?? ''), { keyCode: Number(input?.keycode) })
  })

  ipcMain.handle(IPC_CHANNELS.android.rotate, async (_event, input: { serial: string }) => {
    const serial = String(input?.serial ?? '')
    assertValidSerial(serial)
    const active = streams.get(serial)
    if (active) {
      active.rotated = !active.rotated
      await captureFrame(serial, active).catch(() => {})
    }
    notifyChanged()
  })

  ipcMain.handle(IPC_CHANNELS.android.screenshot, async (_event, input: { serial: string }) => {
    const serial = String(input?.serial ?? '')
    assertValidSerial(serial)
    const png = await deps.devices.screencap(serial)
    const safeSerial = serial.replace(/[^A-Za-z0-9._-]/g, '_')
    const name = `oxespace-android-${safeSerial}-${Date.now()}.png`
    const dir = join(deps.picturesDir ? deps.picturesDir() : app.getPath('pictures'), 'OXESpace')
    await mkdir(dir, { recursive: true })
    const filePath = join(dir, name)
    await writeFile(filePath, png)
    return { path: filePath, name }
  })

  ipcMain.handle(IPC_CHANNELS.android.setAgentsCanSee, async (_event, input: { serial: string; value: boolean }) => {
    deps.access.setAgentsCanSee(String(input?.serial ?? ''), input?.value === true)
    notifyChanged()
  })

  ipcMain.handle(IPC_CHANNELS.android.startEmulator, async (_event, avd: string) => {
    await deps.devices.startAvd(String(avd ?? ''))
    notifyChanged()
  })

  // The person's own actions on a device. No MCP tool, phone command or command-bar entry reaches these channels.
  ipcMain.handle(IPC_CHANNELS.androidActions.pickApk, async (event, input: { serial: string }): Promise<AndroidApkPick | null> => {
    const device = await readyDevice(input?.serial)
    const path = await (deps.pickApk ?? defaultPickApk)(BrowserWindow.fromWebContents(event.sender))
    if (!path) return null
    const sizeBytes = await apkSize(path)
    if (sizeBytes === null) throw new Error('Not an APK file')
    picked = { id: randomUUID(), path, serial: device.serial, sizeBytes, at: Date.now() }
    return { id: picked.id, name: basename(path), sizeBytes }
  })

  ipcMain.handle(IPC_CHANNELS.androidActions.installApk, async (_event, input: { serial: string; id: string }): Promise<AndroidActionOutcome> => {
    const device = await readyDevice(input?.serial)
    const pick = picked
    picked = null
    if (!pick || pick.id !== String(input?.id ?? '') || pick.serial !== device.serial || Date.now() - pick.at > PICK_TTL_MS) return { ok: false, reason: 'pick-expired' }
    if (await apkSize(pick.path) !== pick.sizeBytes) return { ok: false, reason: 'file-changed' }
    const outcome = await deps.devices.installApk(device.serial, pick.path)
    phoneApps.delete(device.serial)
    record('android-install-apk', device.serial, outcome, basename(pick.path).slice(0, 120))
    notifyChanged()
    return outcome
  })

  ipcMain.handle(IPC_CHANNELS.androidActions.openLink, async (_event, input: { serial: string; url: string }): Promise<AndroidActionOutcome> => {
    const device = await readyDevice(input?.serial)
    const url = String(input?.url ?? '')
    const refusal = deviceLinkRefusal(url)
    if (refusal) return { ok: false, reason: `refused:${refusal}` }
    const outcome = await deps.devices.openLink(device.serial, url)
    // The site only: a full address can carry a token in its query.
    record('android-open-link', device.serial, outcome, new URL(url).origin.slice(0, 120))
    return outcome
  })

  ipcMain.handle(IPC_CHANNELS.androidActions.pair, async (_event, input: { serial: string }): Promise<AndroidActionOutcome> => {
    const device = await readyDevice(input?.serial)
    phoneApps.delete(device.serial)
    if (await phoneAppOn(device.serial) !== 'debug') return { ok: false, reason: 'not-debug-build' }
    if (!deps.startPairing) return { ok: false, reason: 'pairing-unavailable' }
    let offer: { uri: string; expiresAt: number }
    try { offer = await deps.startPairing() } catch (cause) { return { ok: false, reason: `pairing-closed:${cause instanceof Error ? cause.message : String(cause)}`.slice(0, 160) } }
    const outcome = await deps.devices.sendPairLink(device.serial, offer.uri)
    record('android-pair-link', device.serial, outcome, null)
    return outcome
  })
}
