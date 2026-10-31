import type { ReactElement } from 'react'
import { AlertCircle, HelpCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ThreadDelivery } from '../../../shared/types/thread'
import { Spinner } from '../../ui'

/**
 * The one line under a user message that is not yet known to be delivered.
 * Delivered messages show nothing, so the transcript stays quiet.
 */
export function ThreadDeliveryNote({ delivery, disabled, onResend }: { delivery: ThreadDelivery; disabled: boolean; onResend: () => void }): ReactElement | null {
  const { t } = useTranslation('thread')
  if (delivery.state === 'delivered') return null
  const label = t(`delivery.${delivery.state}`)
  const resend = delivery.state === 'unconfirmed' ? t('delivery.sendAgain') : delivery.state === 'rejected' ? t('common.tryAgain') : null
  const Icon = delivery.state === 'unconfirmed' ? HelpCircle : AlertCircle
  return <p className={`thread-delivery-note is-${delivery.state}`} role={delivery.state === 'sending' ? 'status' : 'alert'}>
    {delivery.state === 'sending' ? <Spinner size="sm" decorative /> : <Icon size={12} aria-hidden="true" />}
    <span>{delivery.error ? t('delivery.withError', { label, error: delivery.error }) : label}</span>
    {resend && <button type="button" disabled={disabled} onClick={onResend}>{resend}</button>}
  </p>
}
