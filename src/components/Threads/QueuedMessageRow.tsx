import { useState, type ReactElement } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { messageFromError } from '../../../shared/messages'
import { formatMainMessage } from '../../i18n/mainMessage'
import { Button, IconButton, toast } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

export function QueuedMessageRow(props: {
  threadId: string
  item: { id: string; text: string }
  canSteer: boolean
  working: boolean
}): ReactElement {
  const { threadId, item, canSteer, working } = props
  const { t } = useTranslation('thread')
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState<string | null>(null)

  const reportError = (cause: unknown): void => {
    const mainMsg = messageFromError(cause)
    const text = mainMsg ? formatMainMessage(mainMsg) : humanizeError(cause)
    setReason(text)
    toast({ title: text, intent: 'warning' })
  }

  const handleSteer = async (): Promise<void> => {
    setBusy(true)
    try {
      setReason(null)
      await window.oxe?.thread?.steerQueued?.(threadId, item.id)
    } catch (cause) {
      reportError(cause)
    } finally {
      setBusy(false)
    }
  }

  const handleSendNow = async (): Promise<void> => {
    setBusy(true)
    try {
      setReason(null)
      await window.oxe?.thread?.sendQueuedNow?.(threadId, item.id)
    } catch (cause) {
      reportError(cause)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    setBusy(true)
    try {
      setReason(null)
      await window.oxe?.thread?.deleteQueued?.(threadId, item.id)
    } catch (cause) {
      reportError(cause)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="thread-queued-row">
      <span className="thread-queued-text">{t('composerModel.queuedPrefix', { text: item.text })}</span>
      {reason && <span role="status" className="thread-queued-reason">{reason}</span>}
      <div className="thread-queued-actions">
        {canSteer && working && (
          <Button size="sm" variant="secondary" loading={busy} onClick={() => void handleSteer()}>
            {t('composerModel.steerWithThis')}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void handleSendNow()}>
          {t('composerModel.sendNow')}
        </Button>
        <IconButton
          size="sm"
          label={t('composerModel.removeQueued')}
          icon={<X size={12} />}
          disabled={busy}
          onClick={() => void handleDelete()}
        />
      </div>
    </div>
  )
}
