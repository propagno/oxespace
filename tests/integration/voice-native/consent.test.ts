/**
 * OxeVoice F1 · A2 — frozen acceptance test (written by the plan, before execution; do not edit).
 * An engine that sends audio off the machine (`os-cloud`) never starts without the person's explicit consent;
 * consent is persistent, revocable, dated and tied to the version of the text the person accepted.
 */
import { describe, expect, it, vi } from 'vitest'
import { createVoiceConsentStore, VOICE_CONSENT_TEXT_VERSION } from '../../../electron/main/services/voice/consent'
import { createVoiceRegistry } from '../../../electron/main/services/voice/registry'
import type { VoiceEngine } from '../../../electron/main/services/voice/types'

function memoryStorage(initial: string | null = null) {
  let data = initial
  return { read: () => data, write: vi.fn((value: string) => { data = value }), peek: () => data }
}

const cloudEngine = (): VoiceEngine => ({
  id: 'windows-winrt',
  privacy: 'os-cloud',
  platforms: ['win32'],
  probe: async () => ({ available: true, languages: ['pt-BR'], reason: null }),
  start: vi.fn(() => ({ stop: vi.fn(), cancel: vi.fn() }))
})

describe('voice consent (A2)', () => {
  it('starts with no consent and refuses an os-cloud session with voice.consent.required', async () => {
    const engine = cloudEngine()
    const registry = createVoiceRegistry({ platform: 'win32', engines: [engine], consent: createVoiceConsentStore(memoryStorage()) })
    await expect(registry.start({}, () => {})).rejects.toMatchObject({ voiceMessage: { code: 'voice.consent.required', params: { engineId: 'windows-winrt' } } })
    expect(engine.start).not.toHaveBeenCalled()
  })

  it('grant persists the date and the accepted text version; revoke removes it', () => {
    const storage = memoryStorage()
    const now = new Date('2026-11-01T10:00:00.000Z')
    const store = createVoiceConsentStore(storage, { now: () => now })
    expect(store.isGranted('windows-winrt')).toBe(false)

    const record = store.grant('windows-winrt')
    expect(record).toEqual({ engineId: 'windows-winrt', grantedAt: '2026-11-01T10:00:00.000Z', textVersion: VOICE_CONSENT_TEXT_VERSION })
    expect(storage.write).toHaveBeenCalled()

    // A new store over the same storage (an app restart) still sees it.
    const reopened = createVoiceConsentStore(storage)
    expect(reopened.isGranted('windows-winrt')).toBe(true)
    expect(reopened.get('windows-winrt')).toEqual(record)

    reopened.revoke('windows-winrt')
    expect(createVoiceConsentStore(storage).isGranted('windows-winrt')).toBe(false)
    expect(createVoiceConsentStore(storage).get('windows-winrt')).toBeNull()
  })

  it('consent given to an older text version does not count: the person must accept the new text', () => {
    const storage = memoryStorage(JSON.stringify({ 'windows-winrt': { engineId: 'windows-winrt', grantedAt: '2026-01-01T00:00:00.000Z', textVersion: 'v0-old' } }))
    const store = createVoiceConsentStore(storage)
    expect(store.isGranted('windows-winrt')).toBe(false)
  })

  it('corrupt storage reads as no consent and is never a crash', () => {
    expect(createVoiceConsentStore(memoryStorage('{not json')).isGranted('windows-winrt')).toBe(false)
    expect(createVoiceConsentStore(memoryStorage('[1,2]')).isGranted('windows-winrt')).toBe(false)
  })

  it('after consent the os-cloud engine starts', async () => {
    const engine = cloudEngine()
    const consent = createVoiceConsentStore(memoryStorage())
    consent.grant('windows-winrt')
    const registry = createVoiceRegistry({ platform: 'win32', engines: [engine], consent })
    await expect(registry.start({}, () => {})).resolves.toMatchObject({ engine: { consented: true } })
    expect(engine.start).toHaveBeenCalledTimes(1)
  })
})
