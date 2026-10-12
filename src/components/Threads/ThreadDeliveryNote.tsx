import type { ReactElement } from 'react'
import { AlertCircle, HelpCircle, Loader2 } from 'lucide-react'
import type { ThreadDelivery } from '../../../shared/types/thread'

const COPY: Record<Exclude<ThreadDelivery['state'], 'delivered'>, { label: string; resend?: string }> = {
  sending: { label: 'Sending…' },
  unconfirmed: { label: 'Not confirmed — the provider may not have received this message', resend: 'Send again' },
  rejected: { label: 'Not sent', resend: 'Try again' }
}

/**
 * The one line under a user message that is not yet known to be delivered.
 * Delivered messages show nothing, so the transcript stays quiet.
 */
export function ThreadDeliveryNote({ delivery, disabled, onResend }: { delivery: ThreadDelivery; disabled: boolean; onResend: () => void }): ReactElement | null {
  if (delivery.state === 'delivered') return null
  const copy = COPY[delivery.state]
  const Icon = delivery.state === 'sending' ? Loader2 : delivery.state === 'unconfirmed' ? HelpCircle : AlertCircle
  return <p className={`thread-delivery-note is-${delivery.state}`} role={delivery.state === 'sending' ? 'status' : 'alert'}>
    <Icon size={12} aria-hidden="true" className={delivery.state === 'sending' ? 'thread-spin' : undefined} />
    <span>{copy.label}{delivery.error ? `: ${delivery.error}` : ''}</span>
    {copy.resend && <button type="button" disabled={disabled} onClick={onResend}>{copy.resend}</button>}
  </p>
}
