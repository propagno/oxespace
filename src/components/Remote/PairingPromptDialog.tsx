import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemotePairingPrompt } from '../../../shared/types/remote'
import { Button, Dialog, ErrorState, toast } from '../../ui'
import { remoteApi, useRemoteStore } from '../../store/remote.store'
import styles from '../Settings/DevicesSettings.module.css'

const errorText = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

/**
 * "Pair <phone>? Check the code on the phone" (B9). Answered only here, in the app's window: never from a notification or
 * a global shortcut. Shown wherever the person is (T86); Refuse is where focus starts, and closing refuses.
 */
export default function PairingPromptDialog({ prompt }: { prompt: RemotePairingPrompt }): ReactElement {
  const { t } = useTranslation('settings')
  const [answering, setAnswering] = useState(false)
  const [answerError, setAnswerError] = useState('')
  const answer = async (accept: boolean): Promise<void> => {
    setAnswering(true); setAnswerError('')
    try {
      await remoteApi()?.answerPairing({ promptId: prompt.promptId, accept })
      if (accept) toast({ title: t('devices.pairing.prompt.paired', { device: prompt.deviceName }), intent: 'success' })
      useRemoteStore.getState().apply({ pairing: null })
    } catch (cause) { setAnswerError(t('devices.pairing.prompt.failed', { error: errorText(cause) })) } finally { setAnswering(false) }
  }
  return <Dialog title={t('devices.pairing.prompt.title', { device: prompt.deviceName })} description={t('devices.pairing.prompt.description')} size="sm"
    testId="devices-pairing-prompt" onClose={() => { if (!answering) void answer(false) }}
    footer={<>
      <Button autoFocus disabled={answering} onClick={() => void answer(false)}>{t('devices.pairing.prompt.refuse')}</Button>
      <Button variant="primary" loading={answering} disabled={answering} onClick={() => void answer(true)}>{t('devices.pairing.prompt.accept')}</Button>
    </>}>
    <p className={styles.meta}>{t('devices.pairing.prompt.codeLabel')}</p>
    <p className={styles.verification} data-testid="devices-pairing-verification">{prompt.verification}</p>
    {answerError ? <ErrorState compact title={answerError} /> : null}
  </Dialog>
}
