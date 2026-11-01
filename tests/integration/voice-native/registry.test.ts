/**
 * OxeVoice F1 · A1 — frozen acceptance test (written by the plan, before execution; do not edit).
 * The registry picks an engine per OS and consent, owns one session at a time and stamps every event with its id.
 */
import { describe, expect, it, vi } from 'vitest'
import { createVoiceRegistry } from '../../../electron/main/services/voice/registry'
import { createVoiceConsentStore } from '../../../electron/main/services/voice/consent'
import type { VoiceEngine, VoiceEngineEvent } from '../../../electron/main/services/voice/types'
import type { VoiceSessionEvent } from '../../../shared/types/ipc/voice'
import { VOICE_CHANNELS, VOICE_ENGINE_IDS, VOICE_MESSAGE_CODES } from '../../../shared/types/ipc/voice'

function memoryStorage() {
  let data: string | null = null
  return { read: () => data, write: (value: string) => { data = value } }
}

function fakeEngine(overrides: Partial<VoiceEngine> = {}) {
  const emitters: Array<(event: VoiceEngineEvent) => void> = []
  const session = { stop: vi.fn(), cancel: vi.fn() }
  const engine: VoiceEngine = {
    id: 'windows-winrt',
    privacy: 'os-cloud',
    platforms: ['win32'],
    probe: vi.fn(async () => ({ available: true, languages: ['pt-BR'], reason: null })),
    start: vi.fn((_options, emit) => { emitters.push(emit); return session }),
    ...overrides
  }
  return { engine, session, emit: (event: VoiceEngineEvent) => emitters[emitters.length - 1](event) }
}

describe('voice contract (A1)', () => {
  it('declares the voice:* channels, the engines and the C3 codes', () => {
    expect(Object.values(VOICE_CHANNELS).every(channel => channel.startsWith('voice:'))).toBe(true)
    expect(VOICE_CHANNELS.start).toBe('voice:start')
    expect(VOICE_ENGINE_IDS).toContain('windows-winrt')
    expect(VOICE_MESSAGE_CODES).toContain('voice.consent.required')
  })
})

describe('voice registry (A1)', () => {
  it('lists only the engines of this OS, with privacy, languages and consent state', async () => {
    const win = fakeEngine()
    const mac = fakeEngine({ id: 'macos-sfspeech', privacy: 'on-device', platforms: ['darwin'] })
    const registry = createVoiceRegistry({ platform: 'win32', engines: [win.engine, mac.engine], consent: createVoiceConsentStore(memoryStorage()) })
    const engines = await registry.list()
    expect(engines).toEqual([
      { id: 'windows-winrt', privacy: 'os-cloud', available: false, reason: 'consent-required', languages: ['pt-BR'], consentRequired: true, consented: false }
    ])
    expect(mac.engine.probe).not.toHaveBeenCalled()
  })

  it('reports unsupported-os when no engine runs on this platform', async () => {
    const registry = createVoiceRegistry({ platform: 'linux', engines: [fakeEngine().engine], consent: createVoiceConsentStore(memoryStorage()) })
    await expect(registry.list()).resolves.toEqual([])
    await expect(registry.start({}, () => {})).rejects.toMatchObject({ voiceMessage: { code: 'voice.engine.unavailable' } })
  })

  it('an on-device engine needs no consent and passes the probe reason through', async () => {
    const mac = fakeEngine({ id: 'macos-sfspeech', privacy: 'on-device', platforms: ['darwin'], probe: vi.fn(async () => ({ available: false, languages: [], reason: 'no-language' as const })) })
    const registry = createVoiceRegistry({ platform: 'darwin', engines: [mac.engine], consent: createVoiceConsentStore(memoryStorage()) })
    const [info] = await registry.list()
    expect(info).toMatchObject({ id: 'macos-sfspeech', privacy: 'on-device', available: false, reason: 'no-language', consentRequired: false })
  })

  it('starts one session, stamps events with its id and frees it when it ends', async () => {
    const win = fakeEngine()
    const consent = createVoiceConsentStore(memoryStorage())
    consent.grant('windows-winrt')
    const events: VoiceSessionEvent[] = []
    const registry = createVoiceRegistry({ platform: 'win32', engines: [win.engine], consent })

    const started = await registry.start({ language: 'pt-BR' }, event => events.push(event))
    expect(started.sessionId).toMatch(/\S+/)
    expect(started.engine).toMatchObject({ id: 'windows-winrt', available: true, consented: true })
    expect(win.engine.start).toHaveBeenCalledWith(expect.objectContaining({ sessionId: started.sessionId, language: 'pt-BR' }), expect.any(Function))

    await expect(registry.start({}, () => {})).rejects.toMatchObject({ voiceMessage: { code: 'voice.session.busy' } })

    win.emit({ type: 'listening' })
    win.emit({ type: 'partial', text: 'olá' })
    win.emit({ type: 'final', text: 'olá mundo' })
    win.emit({ type: 'ended', reason: 'stopped' })
    expect(events).toEqual([
      { sessionId: started.sessionId, type: 'listening' },
      { sessionId: started.sessionId, type: 'partial', text: 'olá' },
      { sessionId: started.sessionId, type: 'final', text: 'olá mundo' },
      { sessionId: started.sessionId, type: 'ended', reason: 'stopped' }
    ])

    // The session ended: a new one can start.
    await expect(registry.start({}, () => {})).resolves.toMatchObject({ engine: { id: 'windows-winrt' } })
  })

  it('stop and cancel reach the engine session; an unknown session id is a C3 error', async () => {
    const win = fakeEngine()
    const consent = createVoiceConsentStore(memoryStorage())
    consent.grant('windows-winrt')
    const registry = createVoiceRegistry({ platform: 'win32', engines: [win.engine], consent })
    const { sessionId } = await registry.start({}, () => {})
    await registry.stop(sessionId)
    expect(win.session.stop).toHaveBeenCalledTimes(1)
    await registry.cancel(sessionId)
    expect(win.session.cancel).toHaveBeenCalledTimes(1)
    await expect(registry.stop('nope')).rejects.toMatchObject({ voiceMessage: { code: 'voice.session.notFound' } })
  })
})
