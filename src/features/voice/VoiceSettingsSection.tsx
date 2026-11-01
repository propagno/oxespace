import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VoiceEngineInfo, VoiceRendererApi } from '../../../shared/types/ipc/voice'
import { loadNamespace } from '../../i18n'
import { Button } from '../../ui'

/**
 * Settings › Voice. Consent for an engine that sends audio off the machine (`os-cloud`) is revocable here.
 * Turning it on is an explicit opt-in and never starts recording; on-device engines need no switch.
 */
export function VoiceSettingsSection({ api }: { api: VoiceRendererApi }) {
  const { t } = useTranslation('voice')
  const headingId = useId()
  const [engines, setEngines] = useState<VoiceEngineInfo[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Lazy view: its catalog loads with it, never at boot.
  useEffect(() => { void loadNamespace('voice') }, [])

  useEffect(() => {
    let active = true
    void api.getEngines().then(list => { if (active) setEngines(list) }).catch(() => {})
    return () => { active = false }
  }, [api])

  if (engines.length === 0) return null

  const toggle = async (engine: VoiceEngineInfo) => {
    if (busy) return
    const granted = !engine.consented
    setBusy(true)
    try {
      const next = await api.setConsent({ engineId: engine.id, granted })
      setEngines(next)
      setStatus(t(granted ? 'settings.on' : 'settings.off'))
    } catch {
      // Keep the previous state: the switch still reflects the stored consent.
    } finally {
      setBusy(false)
    }
  }

  const cloud = engines.filter(engine => engine.privacy === 'os-cloud')
  const onDevice = engines.filter(engine => engine.privacy === 'on-device')

  return (
    <div className="voice-settings">
      {cloud.map(engine => (
        <section key={engine.id} className="voice-settings__section" aria-labelledby={`${headingId}-${engine.id}`}>
          <h3 id={`${headingId}-${engine.id}`}>{t('settings.section')}</h3>
          <p>{t('settings.description')}</p>
          <Button
            role="switch"
            aria-checked={engine.consented}
            className="voice-settings__switch"
            disabled={busy}
            onClick={() => { void toggle(engine) }}
          >
            {t('settings.toggle')}
          </Button>
        </section>
      ))}
      {onDevice.length > 0 && <p className="voice-settings__privacy">{t('privacy.onDevice')}</p>}
      {status && <p role="status" className="voice-settings__status">{status}</p>}
    </div>
  )
}
