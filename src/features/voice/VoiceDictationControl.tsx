import type { KeyboardEvent } from 'react'
import { useEffect, useId } from 'react'
import { useTranslation } from 'react-i18next'
import type { VoiceRendererApi, VoiceUnavailableReason } from '../../../shared/types/ipc/voice'
import { useVoiceDictation } from './useVoiceDictation'
import './voice.css'

const REASON_KEYS = {
  'unsupported-os': 'voice.unavailable.unsupportedOs',
  'consent-required': 'voice.unavailable.consentRequired',
  'os-speech-privacy-off': 'voice.unavailable.speechPrivacyOff',
  'no-language': 'voice.unavailable.noLanguage',
  'engine-error': 'voice.unavailable.engineError'
} as const satisfies Record<VoiceUnavailableReason, string>

/** Push-to-talk dictation for the composer: hold the button (or Space/Enter on it) to record. */
export function VoiceDictationControl({ api, onInsert }: { api: VoiceRendererApi; onInsert(text: string): void }) {
  const { t } = useTranslation('thread')
  const voice = useVoiceDictation(api, onInsert)
  const titleId = useId()
  const { engine, phase, askingConsent } = voice

  useEffect(() => {
    if (!askingConsent) return
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') voice.decline() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [askingConsent, voice])

  if (!engine) return null

  const blocked = !engine.available && engine.reason !== 'consent-required'
  const privacy = t(engine.privacy === 'os-cloud' ? 'voice.privacy.osCloud' : 'voice.privacy.onDevice')
  const recording = phase === 'listening'
  const reasonTitle = blocked && engine.reason ? t(REASON_KEYS[engine.reason]) : undefined

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    if (event.repeat) return
    void voice.begin()
  }
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    voice.end()
  }

  return (
    <div className="voice-dictation">
      <button
        type="button"
        className="voice-dictation__button"
        data-recording={recording || undefined}
        aria-label={t('voice.hold')}
        aria-pressed={recording}
        title={reasonTitle ?? t('voice.hold')}
        disabled={blocked}
        onPointerDown={() => { void voice.begin() }}
        onPointerUp={voice.end}
        onPointerLeave={voice.end}
        onBlur={voice.end}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      >
        <span className="voice-dictation__dot" aria-hidden="true" />
      </button>

      {recording ? (
        <div role="status" className="voice-dictation__status">
          <span className="voice-dictation__listening">{t('voice.listening')}</span>
          <span className="voice-dictation__privacy">{privacy}</span>
          <span className="voice-dictation__partial" data-testid="voice-partial">{voice.partial}</span>
        </div>
      ) : (
        <span className="voice-dictation__privacy" data-testid="voice-privacy">{privacy}</span>
      )}

      {voice.error && (
        <div role="alert" className="voice-dictation__alert">
          <span>{voice.error.text}</span>
          {voice.error.code === 'voice.os.speechPrivacyOff' && (
            <button type="button" className="voice-dictation__action" onClick={voice.openSpeechSettings}>{t('voice.openSettings')}</button>
          )}
        </div>
      )}

      {askingConsent && (
        <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="voice-dictation__dialog">
          <h2 id={titleId} className="voice-dictation__dialog-title">{t('voice.consent.title')}</h2>
          <p className="voice-dictation__dialog-body">{t('voice.consent.body')}</p>
          <div className="voice-dictation__dialog-actions">
            <button type="button" className="voice-dictation__action" onClick={voice.decline}>{t('voice.consent.decline')}</button>
            <button type="button" className="voice-dictation__action voice-dictation__action--primary" onClick={() => { void voice.allow() }}>{t('voice.consent.allow')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
