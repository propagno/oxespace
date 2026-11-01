/**
 * OxeVoice F1 · A7 v2 (resolves CR-01, DESIGN review by oxespace-5d) — frozen acceptance test (written by the plan,
 * before execution; do not edit). The copy follows the DESIGN review word for word, in en and pt-BR (namespace `voice`), and a missing
 * dictation language offers the same "open speech settings" action as the speech privacy setting.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../shared/locales/en/voice.json'
import ptBR from '../../../shared/locales/pt-BR/voice.json'
import { VoiceDictationControl } from '../../../src/features/voice/VoiceDictationControl'
import type { VoiceEngineInfo, VoiceRendererApi } from '../../../shared/types/ipc/voice'

type Voice = Record<string, unknown> & { consent: Record<string, string>; error: Record<string, string>; unavailable: Record<string, string> }
// The voice copy lives in its own lazy namespace (`voice.json`, CR-07), never in the hot `thread.json`.
const voiceEn = en as unknown as Voice
const voicePt = ptBR as unknown as Voice

afterEach(() => cleanup())

describe('voice copy v2 (A7 v2 · CR-01)', () => {
  it('en follows the DESIGN review', () => {
    expect(voiceEn.consent.body).toBe("Dictation sends your audio to Microsoft's speech service to turn it into text. Nothing is recorded until you hold the button or the shortcut. You can turn this off in {{place}}.")
    expect(voiceEn.error.generic).toBe("Couldn't continue dictating. Try again.")
    expect(voiceEn.unavailable.consentRequired).toBe("To dictate, allow Microsoft's speech service.")
    expect(voiceEn.unavailable.noLanguage).toBe("No dictation language is installed. Add one in your system's speech settings.")
    expect(voiceEn.unavailable.engineError).toBe("Couldn't use the speech engine right now. Try again.")
    expect(voiceEn.consentPlace).toBe('Settings › Voice')
  })

  it('pt-BR follows the DESIGN review', () => {
    expect(voicePt.consent.body).toBe('O ditado envia seu áudio ao serviço de fala da Microsoft para transformá-lo em texto. Nada é gravado enquanto você não segurar o botão ou o atalho. Você pode desligar isso em {{place}}.')
    expect(voicePt.error.generic).toBe('Não foi possível continuar o ditado. Tente de novo.')
    expect(voicePt.unavailable.consentRequired).toBe('Para ditar, permita o serviço de fala da Microsoft.')
    expect(voicePt.unavailable.noLanguage).toBe('Nenhum idioma de ditado está instalado. Adicione um nas configurações de fala do sistema.')
    expect(voicePt.unavailable.engineError).toBe('Não foi possível usar o motor de fala agora. Tente de novo.')
    expect(voicePt.consentPlace).toBe('Configurações › Voz')
  })

  it('the consent dialog says where to turn it off (the real place, interpolated)', async () => {
    const engine: VoiceEngineInfo = { id: 'windows-winrt', privacy: 'os-cloud', available: false, reason: 'consent-required', languages: ['pt-BR'], consentRequired: true, consented: false }
    const api = fakeApi([engine])
    render(<VoiceDictationControl api={api} onInsert={vi.fn()} />)
    const button = await screen.findByRole('button', { name: /dictate/i })
    await waitFor(() => expect(button).not.toBeDisabled())
    fireEvent.pointerDown(button)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('You can turn this off in Settings › Voice.')
    expect(dialog).not.toHaveTextContent('{{place}}')
  })

  it('no dictation language: the reason is shown with the open speech settings action', async () => {
    const engine: VoiceEngineInfo = { id: 'windows-winrt', privacy: 'os-cloud', available: false, reason: 'no-language', languages: [], consentRequired: true, consented: true }
    const api = fakeApi([engine])
    render(<VoiceDictationControl api={api} onInsert={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /dictate/i })).toBeDisabled())
    expect(await screen.findByText("No dictation language is installed. Add one in your system's speech settings.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /open speech settings/i }))
    expect(api.openSpeechSettings).toHaveBeenCalledTimes(1)
  })
})

function fakeApi(engines: VoiceEngineInfo[]): VoiceRendererApi {
  return {
    getEngines: vi.fn(async () => engines),
    start: vi.fn(async () => ({ ok: true as const, sessionId: 's1', engine: engines[0] })),
    stop: vi.fn(async () => ({ ok: true as const })),
    cancel: vi.fn(async () => ({ ok: true as const })),
    setConsent: vi.fn(async () => engines),
    openSpeechSettings: vi.fn(async () => undefined),
    onEvent: vi.fn(() => () => {})
  }
}
