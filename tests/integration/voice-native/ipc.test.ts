/**
 * OxeVoice F1 · A6 — frozen acceptance test (written by the plan, before execution; do not edit).
 * Every voice handler serves only the application main frame, validates its input, returns C3 refusals as data,
 * sends session events only to the main window, and the voice domain is forbidden to agents in the MCP coverage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const windows = new Set<unknown>()
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => 'C:\\tmp' },
  shell: { openExternal: vi.fn(async () => undefined) },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel)
  },
  BrowserWindow: { fromWebContents: (contents: unknown) => (windows.has(contents) ? {} : null), getAllWindows: () => [] }
}))

const { registerVoiceIpc } = await import('../../../electron/main/ipc/voice-session.ipc')
const { createVoiceRegistry } = await import('../../../electron/main/services/voice/registry')
const { createVoiceConsentStore } = await import('../../../electron/main/services/voice/consent')
const { VOICE_CHANNELS } = await import('../../../shared/types/ipc/voice')
const { MCP_COVERAGE, FORBIDDEN_CAPABILITIES } = await import('../../../shared/mcp-coverage')

function appEvent() {
  const mainFrame = {}
  const sender = { mainFrame }
  windows.add(sender)
  return { sender, senderFrame: mainFrame }
}
/** The main window, but a sub-frame (an embedded page): refused. */
function subFrameEvent() {
  const sender = { mainFrame: {} }
  windows.add(sender)
  return { sender, senderFrame: {} }
}
/** Some other WebContents (a preview guest): refused. */
function foreignEvent() {
  const mainFrame = {}
  return { sender: { mainFrame }, senderFrame: mainFrame }
}

function setup() {
  handlers.clear()
  let data: string | null = null
  const consent = createVoiceConsentStore({ read: () => data, write: value => { data = value } })
  const session = { stop: vi.fn(), cancel: vi.fn() }
  let emit: ((event: unknown) => void) | null = null
  const registry = createVoiceRegistry({
    platform: 'win32',
    consent,
    engines: [{
      id: 'windows-winrt', privacy: 'os-cloud', platforms: ['win32'],
      probe: async () => ({ available: true, languages: ['pt-BR'], reason: null }),
      start: (_options, e) => { emit = e as never; return session }
    }]
  })
  const sendToMainWindow = vi.fn()
  const openSpeechSettings = vi.fn(async () => undefined)
  registerVoiceIpc({ registry, consent, sendToMainWindow, openSpeechSettings })
  const call = (channel: string, event: unknown, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`no handler for ${channel}`)
    return Promise.resolve().then(() => handler(event, ...args))
  }
  return { call, sendToMainWindow, openSpeechSettings, session, emit: (event: unknown) => emit!(event) }
}

beforeEach(() => { windows.clear() })

describe('voice IPC (A6)', () => {
  it('registers every request channel of the contract', () => {
    setup()
    for (const channel of [VOICE_CHANNELS.getEngines, VOICE_CHANNELS.start, VOICE_CHANNELS.stop, VOICE_CHANNELS.cancel, VOICE_CHANNELS.setConsent, VOICE_CHANNELS.openSpeechSettings]) {
      expect(handlers.has(channel), channel).toBe(true)
    }
  })

  it('refuses sub-frames and foreign contents on every channel', async () => {
    const { call } = setup()
    for (const channel of [VOICE_CHANNELS.getEngines, VOICE_CHANNELS.start, VOICE_CHANNELS.stop, VOICE_CHANNELS.cancel, VOICE_CHANNELS.setConsent, VOICE_CHANNELS.openSpeechSettings]) {
      await expect(call(channel, subFrameEvent(), {}), channel).rejects.toThrow(/main frame/i)
      await expect(call(channel, foreignEvent(), {}), channel).rejects.toThrow(/main frame/i)
    }
  })

  it('start without consent comes back as a C3 refusal, not a thrown error', async () => {
    const { call } = setup()
    await expect(call(VOICE_CHANNELS.start, appEvent(), {})).resolves.toEqual({
      ok: false, message: { code: 'voice.consent.required', params: { engineId: 'windows-winrt' } }
    })
  })

  it('consent through IPC is validated and returns the engines; then start works and events go to the main window', async () => {
    const { call, sendToMainWindow, emit, session } = setup()
    await expect(call(VOICE_CHANNELS.setConsent, appEvent(), { engineId: 'not-an-engine', granted: true })).rejects.toThrow()
    await expect(call(VOICE_CHANNELS.setConsent, appEvent(), { engineId: 'windows-winrt', granted: 'yes' })).rejects.toThrow()

    const engines = await call(VOICE_CHANNELS.setConsent, appEvent(), { engineId: 'windows-winrt', granted: true }) as Array<{ consented: boolean }>
    expect(engines[0].consented).toBe(true)

    const started = await call(VOICE_CHANNELS.start, appEvent(), { language: 'pt-BR' }) as { ok: boolean; sessionId: string }
    expect(started.ok).toBe(true)
    emit({ type: 'partial', text: 'oi' })
    expect(sendToMainWindow).toHaveBeenCalledWith(VOICE_CHANNELS.onEvent, { sessionId: started.sessionId, type: 'partial', text: 'oi' })

    await expect(call(VOICE_CHANNELS.stop, appEvent(), started.sessionId)).resolves.toEqual({ ok: true })
    expect(session.stop).toHaveBeenCalled()
    await expect(call(VOICE_CHANNELS.stop, appEvent(), 'unknown-session')).resolves.toEqual({ ok: false, message: { code: 'voice.session.notFound', params: {} } })

    const revoked = await call(VOICE_CHANNELS.setConsent, appEvent(), { engineId: 'windows-winrt', granted: false }) as Array<{ consented: boolean }>
    expect(revoked[0].consented).toBe(false)
  })

  it('validates start input: unknown engine or non-BCP-47 language is refused', async () => {
    const { call } = setup()
    await call(VOICE_CHANNELS.setConsent, appEvent(), { engineId: 'windows-winrt', granted: true })
    await expect(call(VOICE_CHANNELS.start, appEvent(), { engineId: 'evil' })).rejects.toThrow()
    await expect(call(VOICE_CHANNELS.start, appEvent(), { language: 'pt-BR"; calc' })).rejects.toThrow()
    await expect(call(VOICE_CHANNELS.stop, appEvent(), 42)).rejects.toThrow()
  })

  it('opens the OS speech settings through the injected opener only', async () => {
    const { call, openSpeechSettings } = setup()
    await call(VOICE_CHANNELS.openSpeechSettings, appEvent())
    expect(openSpeechSettings).toHaveBeenCalledTimes(1)
  })
})

describe('MCP coverage: agents never reach the microphone (A6)', () => {
  it('the voice:* request channels belong to a forbidden capability', () => {
    const keys = ['voice.getEngines', 'voice.start', 'voice.stop', 'voice.cancel', 'voice.setConsent', 'voice.openSpeechSettings']
    const covers = (pattern: string, key: string) => pattern === key || (pattern.endsWith('.*') && key.startsWith(pattern.slice(0, -1)))
    for (const key of keys) {
      const owners = Object.entries(MCP_COVERAGE).filter(([, capability]) => (capability.ipc ?? []).some(pattern => covers(pattern, key)))
      expect(owners.length, key).toBeGreaterThan(0)
      for (const [id, capability] of owners) {
        expect('forbidden' in capability, `${key} → ${id}`).toBe(true)
        expect((FORBIDDEN_CAPABILITIES as readonly string[]).includes(id), `${id} in FORBIDDEN_CAPABILITIES`).toBe(true)
      }
    }
  })
})
