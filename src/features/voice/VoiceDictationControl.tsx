import type { KeyboardEvent } from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { VoiceRendererApi, VoiceUnavailableReason } from '../../../shared/types/ipc/voice'
import { loadNamespace } from '../../i18n'
import { Button, ConfirmDialog, ErrorState, IconButton } from '../../ui'
import { useVoiceDictation } from './useVoiceDictation'
import './voice.css'

const REASON_KEYS = {
  'unsupported-os': 'unavailable.unsupportedOs',
  'consent-required': 'unavailable.consentRequired',
  'os-speech-privacy-off': 'unavailable.speechPrivacyOff',
  'no-language': 'unavailable.noLanguage',
  'engine-error': 'unavailable.engineError'
} as const satisfies Record<VoiceUnavailableReason, string>

/** Reasons the person can fix in the OS speech settings: the text is shown, with the action to open them. */
const SETTINGS_REASONS: ReadonlySet<VoiceUnavailableReason> = new Set(['os-speech-privacy-off', 'no-language'])

/** Push-to-talk dictation for the composer: hold the button (or Space/Enter on it) to record. */
export function VoiceDictationControl({ api, onInsert }: { api: VoiceRendererApi; onInsert(text: string): void }) {
  const { t } = useTranslation('voice')
  const voice = useVoiceDictation(api, onInsert)
  const root = useRef<HTMLDivElement>(null)
  const { engine, phase, askingConsent } = voice

  // Lazy view: its catalog loads with it, never at boot.
  useEffect(() => { void loadNamespace('voice') }, [])

  if (!engine) return null

  const blocked = !engine.available && engine.reason !== 'consent-required'
  const privacy = t(engine.privacy === 'os-cloud' ? 'privacy.osCloud' : 'privacy.onDevice')
  const recording = phase === 'listening'
  const reasonText = blocked && engine.reason ? t(REASON_KEYS[engine.reason]) : undefined
  const reasonAction = blocked && !!engine.reason && SETTINGS_REASONS.has(engine.reason)

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
    <div className="voice-dictation" ref={root}>
      <IconButton
        variant="secondary"
        className="voice-dictation__button"
        data-recording={recording || undefined}
        label={t('hold')}
        icon={<span className="voice-dictation__dot" aria-hidden="true" />}
        aria-pressed={recording}
        title={reasonText ?? t('hold')}
        disabled={blocked}
        onPointerDown={() => { void voice.begin() }}
        onPointerUp={voice.end}
        onPointerLeave={voice.end}
        onBlur={voice.end}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      />

      {recording ? (
        <div role="status" className="voice-dictation__status">
          <span className="voice-dictation__listening">{t('listening')}</span>
          <span className="voice-dictation__privacy">{privacy}</span>
          <span className="voice-dictation__partial" data-testid="voice-partial">{voice.partial}</span>
        </div>
      ) : (
        <span className="voice-dictation__privacy" data-testid="voice-privacy">{privacy}</span>
      )}

      {reasonAction && !voice.error && (
        <div className="voice-dictation__reason">
          <span>{reasonText}</span>
          <Button size="sm" onClick={voice.openSpeechSettings}>{t('openSettings')}</Button>
        </div>
      )}

      {voice.error && (
        <ErrorState
          compact
          title={voice.error.text}
          actions={voice.error.code === 'voice.os.speechPrivacyOff'
            ? <Button size="sm" onClick={voice.openSpeechSettings}>{t('openSettings')}</Button>
            : undefined}
        />
      )}

      {askingConsent && (
        <ConfirmDialog
          title={t('consent.title')}
          description={t('consent.body', { place: t('consentPlace') })}
          confirmLabel={t('consent.allow')}
          cancelLabel={t('consent.decline')}
          onConfirm={() => { void voice.allow() }}
          onCancel={voice.decline}
          returnFocusTo={() => root.current?.querySelector<HTMLElement>('.voice-dictation__button') ?? null}
        />
      )}
    </div>
  )
}
