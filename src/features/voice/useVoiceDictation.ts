import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VoiceEngineInfo, VoiceMessage, VoiceRendererApi, VoiceSessionEvent } from '../../../shared/types/ipc/voice'
import { i18n } from '../../i18n'
import { formatMainMessage } from '../../i18n/mainMessage'

export type VoicePhase = 'idle' | 'starting' | 'listening'

export interface VoiceErrorState {
  text: string
  code: string | null
}

/** The C3 message in the interface language when the `main` catalog has its key; a generic `thread` text otherwise. */
function wordsFor(message: VoiceMessage, generic: string): string {
  if (i18n.exists(`messages.${message.code}`, { ns: 'main' })) return formatMainMessage(message as unknown as Parameters<typeof formatMainMessage>[0])
  return generic
}

/** State of push-to-talk dictation: engines, the active session, partial text, consent and errors. */
export function useVoiceDictation(api: VoiceRendererApi, onInsert: (text: string) => void) {
  // The voice copy lives in its own lazy namespace (CR-07); `thread` no longer has these keys.
  const { t } = useTranslation('voice')
  const [engines, setEngines] = useState<VoiceEngineInfo[] | null>(null)
  const [phase, setPhase] = useState<VoicePhase>('idle')
  const [partial, setPartial] = useState('')
  const [error, setError] = useState<VoiceErrorState | null>(null)
  const [askingConsent, setAskingConsent] = useState(false)

  const sessionRef = useRef<string | null>(null)
  const startingRef = useRef(false)
  const pressedRef = useRef(false)
  const stoppingRef = useRef(false)
  const mountedRef = useRef(false)
  const insertRef = useRef(onInsert)
  const genericText = t('error.generic')
  const genericRef = useRef(genericText)

  // Sync the latest callback/text into refs after commit (not during render); declared before the subscription effect so it runs first.
  useEffect(() => {
    insertRef.current = onInsert
    genericRef.current = genericText
  }, [onInsert, genericText])

  const engine = engines && engines.length > 0 ? engines[0] : null
  const needsConsent = !!engine && engine.consentRequired && !engine.consented

  useEffect(() => {
    mountedRef.current = true
    let alive = true
    void api.getEngines().then(list => { if (alive) setEngines(list) }).catch(() => { if (alive) setEngines([]) })
    const unsubscribe = api.onEvent((event: VoiceSessionEvent) => {
      if (!alive) return
      if (sessionRef.current && event.sessionId !== sessionRef.current) return
      switch (event.type) {
        case 'listening': setPhase('listening'); break
        case 'partial': setPartial(event.text); break
        case 'final': setPartial(''); insertRef.current(event.text); break
        case 'error': setError({ text: wordsFor(event.message, genericRef.current), code: event.message.code }); break
        case 'ended':
          sessionRef.current = null
          stoppingRef.current = false
          setPhase('idle')
          setPartial('')
          break
      }
    })
    return () => {
      alive = false
      mountedRef.current = false
      unsubscribe()
      const id = sessionRef.current
      sessionRef.current = null
      if (id) void api.cancel(id).catch(() => {})
    }
  }, [api])

  const stopSession = useCallback(() => {
    const id = sessionRef.current
    if (!id || stoppingRef.current) return
    stoppingRef.current = true
    void api.stop(id).catch(() => {})
  }, [api])

  const begin = useCallback(async () => {
    if (!engine || sessionRef.current || startingRef.current) return
    if (needsConsent) { setAskingConsent(true); return }
    if (!engine.available) return
    pressedRef.current = true
    startingRef.current = true
    setError(null)
    setPhase('starting')
    try {
      const result = await api.start({ engineId: engine.id })
      if (!mountedRef.current) {
        if (result.ok) void api.cancel(result.sessionId).catch(() => {})
        return
      }
      if (!result.ok) {
        setPhase('idle')
        setError({ text: wordsFor(result.message, genericRef.current), code: result.message.code })
        return
      }
      sessionRef.current = result.sessionId
      stoppingRef.current = false
      if (!pressedRef.current) stopSession()
    } catch {
      if (mountedRef.current) { setPhase('idle'); setError({ text: genericRef.current, code: null }) }
    } finally {
      startingRef.current = false
    }
  }, [api, engine, needsConsent, stopSession])

  const end = useCallback(() => {
    pressedRef.current = false
    stopSession()
  }, [stopSession])

  const allow = useCallback(async () => {
    if (!engine) return
    setAskingConsent(false)
    try {
      const list = await api.setConsent({ engineId: engine.id, granted: true })
      if (mountedRef.current) setEngines(list)
    } catch {
      if (mountedRef.current) setError({ text: genericRef.current, code: null })
    }
  }, [api, engine])

  const decline = useCallback(() => setAskingConsent(false), [])
  const openSpeechSettings = useCallback(() => { void api.openSpeechSettings().catch(() => {}) }, [api])

  return { engine, engines, phase, partial, error, askingConsent, begin, end, allow, decline, openSpeechSettings }
}
