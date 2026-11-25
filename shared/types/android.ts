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
  /** OXE-112: true only for emulators started by OXESpace; never for external emulators or physical devices. */
  owned?: boolean
}

/** OXE-112: the last device that left adb unexpectedly, surfaced in the panel and notified to agents. */
export interface AndroidDisconnectedDevice {
  serial: string
  name: string
  kind: AndroidMirrorDevice['kind']
  at: number
}

/** The APK the person picked in the system's dialog, held by main until they confirm: the window never names a path. */
export interface AndroidApkPick { id: string; name: string; sizeBytes: number }
/** How an action on the device ended. `reason` is the device's own word for a failure, or one of ours for a refusal. */
export type AndroidActionOutcome = { ok: true } | { ok: false; reason: string }

export interface AndroidEmulatorLaunchOptions {
  /** Launch with low-footprint flags (-no-boot-anim, -no-audio, -memory 2048, -no-snapshot-save). */
  lightweight?: boolean
}

export interface AndroidEmulatorMemoryCheck {
  ok: boolean
  freeMb: number
  requiredMb: number
  lightweight: boolean
}

export interface AndroidMirrorStatus {
  adb: 'missing' | 'ok'
  devices: AndroidMirrorDevice[]
  avds: string[]
  /** Free host memory in MiB at the time status was read, when available. */
  freeMemoryMb?: number
  /** OXE-112: populated when an active device leaves adb unexpectedly; cleared once it returns. */
  disconnectedDevice?: AndroidDisconnectedDevice | null
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
  startEmulator(avd: string, options?: AndroidEmulatorLaunchOptions): Promise<void>
  /** Opens the system's file dialog for an APK to install on the device; null when the person cancels. */
  pickApk(input: { serial: string }): Promise<AndroidApkPick | null>
  /** Installs the APK picked before, by its id, after the person confirmed. */
  installApk(input: { serial: string; id: string }): Promise<AndroidActionOutcome>
  /** Opens an http or https address in the device's browser. */
  openLink(input: { serial: string; url: string }): Promise<AndroidActionOutcome>
  /** Opens pairing on this computer and hands its link to the phone app on the device (a debug build). */
  pair(input: { serial: string }): Promise<AndroidActionOutcome>
  /** OXE-112: stops an emulator started by OXESpace; refuses external emulators and physical devices. */
  stopEmulator?(input: { serial: string }): Promise<AndroidActionOutcome>
  onChanged(listener: (status?: AndroidMirrorStatus) => void): () => void
  onFrame(listener: (frame: AndroidMirrorFrame) => void): () => void
  /** main asks the window to open the Android device panel: an agent asked for this device (OXE-109). */
  onOpenPanel?(listener: (request: AndroidOpenPanelRequest) => void): () => void
}

/** Which workspace's agent asked for which device, when main opens the panel for the person. */
export interface AndroidOpenPanelRequest { workspaceId: string; serial: string }
