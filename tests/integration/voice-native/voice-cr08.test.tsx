/**
 * OxeVoice F1 · CR-08 (independent typecheck found it) — frozen acceptance test. The hook kept reading
 * `voice.error.generic` from the `thread` namespace after the copy moved to `voice` (CR-07): a refused start without a
 * main-catalog message showed the raw key. The generic error is the DESIGN copy from the `voice` namespace.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceDictationControl } from '../../../src/features/voice/VoiceDictationControl'
import type { VoiceEngineInfo, VoiceRendererApi } from '../../../shared/types/ipc/voice'

afterEach(() => cleanup())

describe('generic voice error copy (CR-08)', () => {
  it('a refused start with no main-catalog text shows the voice namespace copy, never a raw key', async () => {
    const engine: VoiceEngineInfo = { id: 'windows-winrt', privacy: 'os-cloud', available: true, reason: null, languages: ['pt-BR'], consentRequired: true, consented: true }
    const api: VoiceRendererApi = {
      getEngines: vi.fn(async () => [engine]),
      start: vi.fn(async () => ({ ok: false as const, message: { code: 'voice.session.busy' as const, params: {} } })),
      stop: vi.fn(async () => ({ ok: true as const })),
      cancel: vi.fn(async () => ({ ok: true as const })),
      setConsent: vi.fn(async () => [engine]),
      openSpeechSettings: vi.fn(async () => undefined),
      onEvent: vi.fn(() => () => {})
    }
    render(<VoiceDictationControl api={api} onInsert={vi.fn()} />)
    const button = await screen.findByRole('button', { name: /dictate/i })
    fireEvent.pointerDown(button)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't continue dictating. Try again.")
    expect(alert.textContent).not.toMatch(/voice\.|error\.generic/)
  })
})
