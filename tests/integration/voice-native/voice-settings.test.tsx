/**
 * OxeVoice F1 · A2 / CR-02 (DESIGN review by oxespace-5d) — frozen acceptance test (written by the plan, before
 * execution; do not edit). Consent for a cloud engine is revocable in a real place: the "Microsoft speech service"
 * section of Settings › Voice. Turning it off says what happens next; turning it on is an explicit opt-in and never
 * starts recording. On-device engines need no switch.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceSettingsSection } from '../../../src/features/voice/VoiceSettingsSection'
import type { VoiceEngineInfo, VoiceRendererApi } from '../../../shared/types/ipc/voice'

afterEach(() => cleanup())

const cloud = (consented: boolean): VoiceEngineInfo => ({
  id: 'windows-winrt', privacy: 'os-cloud', available: consented, reason: consented ? null : 'consent-required', languages: ['pt-BR'], consentRequired: true, consented
})

function fakeApi(initial: VoiceEngineInfo[]) {
  let engines = initial
  const api: VoiceRendererApi = {
    getEngines: vi.fn(async () => engines),
    start: vi.fn(async () => ({ ok: true as const, sessionId: 's1', engine: engines[0] })),
    stop: vi.fn(async () => ({ ok: true as const })),
    cancel: vi.fn(async () => ({ ok: true as const })),
    setConsent: vi.fn(async ({ granted }) => { engines = engines.map(e => (e.privacy === 'os-cloud' ? cloud(granted) : e)); return engines }),
    openSpeechSettings: vi.fn(async () => undefined),
    onEvent: vi.fn(() => () => {})
  }
  return api
}

describe('Settings › Voice — revocable consent (A2 · CR-02)', () => {
  it('shows the Microsoft speech service section with a switch that reflects the consent', async () => {
    const api = fakeApi([cloud(true)])
    render(<VoiceSettingsSection api={api} />)
    expect(await screen.findByRole('heading', { name: 'Microsoft speech service' })).toBeInTheDocument()
    const toggle = await screen.findByRole('switch')
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
    expect(screen.getAllByText(/Microsoft's speech service/).length).toBeGreaterThan(0)
  })

  it('turning it off revokes the consent and says dictation will ask again', async () => {
    const api = fakeApi([cloud(true)])
    render(<VoiceSettingsSection api={api} />)
    const toggle = await screen.findByRole('switch')
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
    await act(async () => { fireEvent.click(toggle) })
    expect(api.setConsent).toHaveBeenCalledWith({ engineId: 'windows-winrt', granted: false })
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'))
    expect(screen.getByRole('status')).toHaveTextContent('Off. Dictation will ask again.')
  })

  it('turning it on is an explicit opt-in and never starts recording', async () => {
    const api = fakeApi([cloud(false)])
    render(<VoiceSettingsSection api={api} />)
    const toggle = await screen.findByRole('switch')
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'))
    await act(async () => { fireEvent.click(toggle) })
    expect(api.setConsent).toHaveBeenCalledWith({ engineId: 'windows-winrt', granted: true })
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
    expect(api.start).not.toHaveBeenCalled()
  })

  it('an on-device engine has no consent switch, only where the audio stays', async () => {
    const api = fakeApi([{ id: 'macos-sfspeech', privacy: 'on-device', available: true, reason: null, languages: ['pt-BR'], consentRequired: false, consented: false }])
    render(<VoiceSettingsSection api={api} />)
    expect(await screen.findByText('Audio stays on this device')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).toBeNull()
  })
})
