/**
 * OxeVoice F1 · A6 v2 (resolves CR-05 and CR-06, TECH LEAD oxespace-71) — frozen acceptance test (written by the
 * plan, before execution; do not edit).
 * - #261 (B12) removed `requireAppFrame`: the global `installIpcSenderGuard` answers only the trusted app window, so
 *   the voice handlers register plainly and the guard refuses everyone else.
 * - The voice service stays out of the static main entry: the registry, the helper and the protocol load through
 *   `await import()` (the `loadVoice` loader) on the first voice:* call, once.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const fakeIpcMain = {
  handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => { handlers.set(channel, handler) },
  removeHandler: (channel: string) => { handlers.delete(channel) }
}
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => 'C:\\tmp', on: () => undefined },
  shell: { openExternal: vi.fn(async () => undefined) },
  ipcMain: fakeIpcMain,
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] }
}))
vi.mock('../../../electron/main/services/diagnostics/incident-sink', () => ({ recordIncident: vi.fn() }))

const { installIpcSenderGuard, trustAppWindow, IpcSenderRefusedError } = await import('../../../electron/main/ipc/ipc-sender-guard')
const { registerVoiceIpc } = await import('../../../electron/main/ipc/voice-session.ipc')
const { createVoiceRegistry } = await import('../../../electron/main/services/voice/registry')
const { createVoiceConsentStore } = await import('../../../electron/main/services/voice/consent')
const { VOICE_CHANNELS } = await import('../../../shared/types/ipc/voice')

installIpcSenderGuard(fakeIpcMain, null)

function contents() {
  const mainFrame = {}
  return { mainFrame }
}
const appWindow = contents()
trustAppWindow({ webContents: appWindow as never })
const appEvent = () => ({ sender: appWindow, senderFrame: appWindow.mainFrame })
const strangerEvent = () => { const other = contents(); return { sender: other, senderFrame: other.mainFrame } }
const subFrameEvent = () => ({ sender: appWindow, senderFrame: {} })

function setup() {
  handlers.clear()
  let data: string | null = null
  const consent = createVoiceConsentStore({ read: () => data, write: value => { data = value } })
  const registry = createVoiceRegistry({
    platform: 'win32',
    consent,
    engines: [{
      id: 'windows-winrt', privacy: 'os-cloud', platforms: ['win32'],
      probe: async () => ({ available: true, languages: ['pt-BR'], reason: null }),
      start: () => ({ stop: vi.fn(), cancel: vi.fn() })
    }]
  })
  const loadVoice = vi.fn(async () => ({ registry, consent }))
  registerVoiceIpc({ loadVoice, sendToMainWindow: vi.fn(), openSpeechSettings: vi.fn(async () => undefined) })
  const call = (channel: string, event: unknown, ...args: unknown[]) => Promise.resolve().then(() => handlers.get(channel)!(event, ...args))
  return { call, loadVoice }
}

beforeEach(() => { handlers.clear() })

describe('voice IPC under the global sender guard (A6 v2 · CR-05)', () => {
  it('the handlers no longer use requireAppFrame', () => {
    const source = readFileSync(resolve(__dirname, '../../../electron/main/ipc/voice-session.ipc.ts'), 'utf8')
    expect(source).not.toMatch(/requireAppFrame/)
  })

  it('the trusted app window is answered; a stranger or a sub-frame is refused on every channel', async () => {
    const { call } = setup()
    for (const channel of [VOICE_CHANNELS.getEngines, VOICE_CHANNELS.start, VOICE_CHANNELS.stop, VOICE_CHANNELS.cancel, VOICE_CHANNELS.setConsent, VOICE_CHANNELS.openSpeechSettings]) {
      expect(handlers.has(channel), channel).toBe(true)
      await expect(call(channel, strangerEvent(), {}), channel).rejects.toBeInstanceOf(IpcSenderRefusedError)
      await expect(call(channel, subFrameEvent(), {}), channel).rejects.toBeInstanceOf(IpcSenderRefusedError)
    }
    await expect(call(VOICE_CHANNELS.getEngines, appEvent())).resolves.toEqual([expect.objectContaining({ id: 'windows-winrt' })])
    await expect(call(VOICE_CHANNELS.start, appEvent(), {})).resolves.toEqual({ ok: false, message: { code: 'voice.consent.required', params: { engineId: 'windows-winrt' } } })
  })

  it('input validation still refuses bad payloads from the trusted window', async () => {
    const { call } = setup()
    await expect(call(VOICE_CHANNELS.setConsent, appEvent(), { engineId: 'evil', granted: true })).rejects.toThrow()
    await expect(call(VOICE_CHANNELS.start, appEvent(), { language: 'pt-BR"; calc' })).rejects.toThrow()
  })
})

describe('voice service out of the static main entry (CR-06)', () => {
  it('voice-session.ipc.ts imports the voice services only as types (plus the tiny errors module)', () => {
    const source = readFileSync(resolve(__dirname, '../../../electron/main/ipc/voice-session.ipc.ts'), 'utf8')
    const staticValueImports = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/gm)].map(m => m[1])
    expect(staticValueImports.filter(p => /services\/voice\/(registry|windows-helper|protocol|consent|bootstrap)/.test(p))).toEqual([])
  })

  it('loadVoice runs on the first voice:* call only, and once', async () => {
    const { call, loadVoice } = setup()
    expect(loadVoice).not.toHaveBeenCalled()
    await call(VOICE_CHANNELS.getEngines, appEvent())
    await call(VOICE_CHANNELS.getEngines, appEvent())
    await call(VOICE_CHANNELS.start, appEvent(), {})
    expect(loadVoice).toHaveBeenCalledTimes(1)
  })

  it('a bootstrap module builds the runtime from injected paths (what the lazy import loads)', async () => {
    const { createVoiceRuntime } = await import('../../../electron/main/services/voice/bootstrap')
    const os = await import('node:os')
    const fs = await import('node:fs')
    const path = await import('node:path')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxe-voice-boot-'))
    try {
      const runtime = createVoiceRuntime({ platform: 'linux', resourcesPath: dir, userDataPath: dir, env: {} })
      await expect(runtime.registry.list()).resolves.toEqual([])
      runtime.consent.grant('windows-winrt')
      const reopened = createVoiceRuntime({ platform: 'linux', resourcesPath: dir, userDataPath: dir, env: {} })
      expect(reopened.consent.isGranted('windows-winrt')).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
