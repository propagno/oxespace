import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import { QrCode } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { readPairingUri } from '../../../shared/remote/protocol'
import type { RemotePairingOffer } from '../../../shared/types/remote'
import { Button, Dialog, ErrorState, Panel, toast } from '../../ui'
import { remoteApi, useRemoteStore } from '../../store/remote.store'
import { encodeQr, qrPath } from '../../utils/qrCode'
import styles from './DevicesSettings.module.css'

const QR_MARGIN = 4
const errorText = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)
/** The certificate fingerprint in groups of four, as the phone shows it. */
export const groupFingerprint = (fp: string): string => fp.toUpperCase().match(/.{1,4}/g)?.join(' ') ?? fp
const remaining = (ms: number): string => {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * Shows a one-time pairing code as a QR, with its text alternative (address, code and certificate fingerprint), and
 * asks the person to confirm the phone that answers it. Leaving the page withdraws the code.
 */
export function DevicesPairing({ canPair, blockedReason }: { canPair: boolean; blockedReason: string | null }): ReactElement {
  const { t } = useTranslation('settings')
  const prompt = useRemoteStore(state => state.pairing)
  const [offer, setOffer] = useState<RemotePairingOffer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [answering, setAnswering] = useState(false)
  const [answerError, setAnswerError] = useState('')
  const offerRef = useRef<RemotePairingOffer | null>(null)
  const captionId = useId()

  useEffect(() => { offerRef.current = offer }, [offer])
  useEffect(() => () => { if (offerRef.current) void remoteApi()?.cancelPairing().catch(() => undefined) }, [])
  useEffect(() => {
    if (!offer) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [offer])
  // A code is good for one attempt: once a phone answers it, it leaves the screen. Turning the connection off withdraws it.
  useEffect(() => useRemoteStore.subscribe((state, previous) => {
    if ((state.pairing && !previous.pairing) || (previous.status?.enabled && !state.status?.enabled)) setOffer(null)
  }), [])

  const parsed = useMemo(() => offer ? readPairingUri(offer.uri) : null, [offer])
  const path = useMemo(() => {
    if (!offer || !parsed?.ok) return null
    const code = encodeQr(offer.uri)
    return { d: qrPath(code, QR_MARGIN), size: code.size + QR_MARGIN * 2 }
  }, [parsed, offer])
  const expired = !!offer && now >= offer.expiresAt

  const start = async (): Promise<void> => {
    const api = remoteApi()
    if (!api) return
    setBusy(true); setError('')
    try { const next = await api.startPairing(); setNow(Date.now()); setOffer(next) } catch (cause) { setError(t('devices.pairing.failed', { error: errorText(cause) })) } finally { setBusy(false) }
  }
  const cancel = async (): Promise<void> => {
    setOffer(null)
    try { await remoteApi()?.cancelPairing() } catch { /* The code expires on its own. */ }
  }
  const answer = async (accept: boolean): Promise<void> => {
    if (!prompt) return
    setAnswering(true); setAnswerError('')
    try {
      await remoteApi()?.answerPairing({ promptId: prompt.promptId, accept })
      if (accept) toast({ title: t('devices.pairing.prompt.paired', { device: prompt.deviceName }), intent: 'success' })
      useRemoteStore.getState().apply({ pairing: null })
    } catch (cause) { setAnswerError(t('devices.pairing.prompt.failed', { error: errorText(cause) })) } finally { setAnswering(false) }
  }

  return <Panel title={t('devices.pairing.title')} label={t('devices.pairing.title')}>
    <div className={styles.stack}>
      <p className={styles.meta}>{t('devices.pairing.hint')}</p>
      {blockedReason ? <p className={styles.meta}>{blockedReason}</p> : null}
      {error ? <ErrorState compact title={error} /> : null}
      {offer && parsed && !parsed.ok ? <ErrorState compact title={t('devices.pairing.unreadable')} /> : null}
      {offer && parsed?.ok && path ? <div className={styles.offer} data-testid="devices-pairing-offer">
        {expired ? <p className={styles.note} role="status">{t('devices.pairing.expired')}</p>
          : <svg className={styles.qr} viewBox={`0 0 ${path.size} ${path.size}`} role="img" aria-labelledby={captionId} shapeRendering="crispEdges" data-testid="devices-pairing-qr">
            <title id={captionId}>{t('devices.pairing.qrLabel')}</title>
            <path d={path.d} fill="currentColor" />
          </svg>}
        <dl className={styles.details}>
          <div><dt>{t('devices.pairing.address')}</dt><dd>{parsed.qr.host.includes(':') ? `[${parsed.qr.host}]:${parsed.qr.port}` : `${parsed.qr.host}:${parsed.qr.port}`}</dd></div>
          <div><dt>{t('devices.pairing.code')}</dt><dd data-testid="devices-pairing-code">{parsed.qr.code}</dd></div>
          <div><dt>{t('devices.pairing.fingerprint')}</dt><dd data-testid="devices-pairing-fingerprint">{groupFingerprint(parsed.qr.fp)}</dd>
            <dd className={styles.meta}>{t('devices.pairing.fingerprintHint')}</dd></div>
          {!expired ? <div><dt className={styles.meta} aria-live="off">{t('devices.pairing.expiresIn', { time: remaining(offer.expiresAt - now) })}</dt></div> : null}
        </dl>
      </div> : null}
      <div className={styles.actions}>
        {!offer || expired ? <Button variant="primary" icon={<QrCode size={14} aria-hidden="true" />} loading={busy} disabled={!canPair || busy} onClick={() => void start()}>
          {offer ? t('devices.pairing.newCode') : t('devices.pairing.start')}
        </Button> : null}
        {offer ? <Button onClick={() => void cancel()}>{t('devices.pairing.cancel')}</Button> : null}
      </div>
    </div>
    {prompt ? <Dialog title={t('devices.pairing.prompt.title', { device: prompt.deviceName })} description={t('devices.pairing.prompt.description')} size="sm"
      testId="devices-pairing-prompt" onClose={() => { if (!answering) void answer(false) }}
      footer={<>
        <Button autoFocus disabled={answering} onClick={() => void answer(false)}>{t('devices.pairing.prompt.refuse')}</Button>
        <Button variant="primary" loading={answering} disabled={answering} onClick={() => void answer(true)}>{t('devices.pairing.prompt.accept')}</Button>
      </>}>
      <p className={styles.meta}>{t('devices.pairing.prompt.codeLabel')}</p>
      <p className={styles.verification} data-testid="devices-pairing-verification">{prompt.verification}</p>
      {answerError ? <ErrorState compact title={answerError} /> : null}
    </Dialog> : null}
  </Panel>
}
