import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC_CHANNELS, type AndroidMirrorDevice, type AndroidMirrorFrame, type AndroidMirrorStatus } from '../../../shared/types/ipc'
import { assertValidSerial, type AndroidAgentAccess, type AndroidDevices } from '../services/android/android-devices'

export interface AndroidIpcDeps {
  devices: AndroidDevices
  access: AndroidAgentAccess
  picturesDir?: () => string
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
    const devices: AndroidMirrorDevice[] = listed.devices.map(device => ({
      ...device,
      agentsCanSee: deps.access.agentsCanSee(device.serial),
      stream: device.state === 'device' ? (streams.get(device.serial)?.state ?? 'idle') : 'idle'
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
}
