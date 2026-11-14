import type { PhoneAppBuild } from '../android-actions'

/** The Android device panel's types: the devices adb lists, the mirrored frames, and what the window may ask main. */
export interface AndroidMirrorDevice {
  serial: string
  name: string
  kind: 'emulator' | 'usb' | 'wifi'
  api?: number
  state: 'device' | 'offline' | 'unauthorized' | 'recovery' | 'sideload' | 'authorizing' | 'no-permissions'
  agentsCanSee?: boolean
  stream?: 'idle' | 'connecting' | 'live'
  /** The OXESpace phone app on this device: only a debug build takes the pairing link from the panel. */
  phoneApp?: PhoneAppBuild
}

/** The APK the person picked in the system's dialog, held by main until they confirm: the window never names a path. */
export interface AndroidApkPick { id: string; name: string; sizeBytes: number }
/** How an action on the device ended. `reason` is the device's own word for a failure, or one of ours for a refusal. */
export type AndroidActionOutcome = { ok: true } | { ok: false; reason: string }

export interface AndroidMirrorStatus {
  adb: 'missing' | 'ok'
  devices: AndroidMirrorDevice[]
  avds: string[]
}

export interface AndroidMirrorFrame {
  serial: string
  width: number
  height: number
  data: Uint8Array
}

export interface AndroidApi {
  status(): Promise<AndroidMirrorStatus>
  connect(input: { serial: string }): Promise<{ ok: boolean } | void>
  disconnect(input: { serial: string }): Promise<void>
  tap(input: { serial: string; x: number; y: number }): Promise<void>
  swipe(input: { serial: string; x1: number; y1: number; x2: number; y2: number; durationMs?: number }): Promise<void>
  key(input: { serial: string; keycode: number }): Promise<void>
  rotate(input: { serial: string }): Promise<void>
  screenshot(input: { serial: string }): Promise<{ path: string; name: string }>
  setAgentsCanSee(input: { serial: string; value: boolean }): Promise<void>
  startEmulator(avd: string): Promise<void>
  /** Opens the system's file dialog for an APK to install on the device; null when the person cancels. */
  pickApk(input: { serial: string }): Promise<AndroidApkPick | null>
  /** Installs the APK picked before, by its id, after the person confirmed. */
  installApk(input: { serial: string; id: string }): Promise<AndroidActionOutcome>
  /** Opens an http or https address in the device's browser. */
  openLink(input: { serial: string; url: string }): Promise<AndroidActionOutcome>
  /** Opens pairing on this computer and hands its link to the phone app on the device (a debug build). */
  pair(input: { serial: string }): Promise<AndroidActionOutcome>
  onChanged(listener: (status?: AndroidMirrorStatus) => void): () => void
  onFrame(listener: (frame: AndroidMirrorFrame) => void): () => void
}
