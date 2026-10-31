import type { ReactElement, ReactNode } from 'react'
import { i18n } from '../i18n'
import { Button } from './Button'
import { Dialog } from './Overlay'

export interface ConfirmDialogProps {
  /** The question, ending in a question mark: "Archive this conversation?" */
  title: string
  /** What will happen, in plain words. Required: a confirmation without a consequence is just a speed bump. */
  description: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** Destructive actions, and ones that widen what an agent may do, get the danger button; focus starts on the safe button either way. */
  danger?: boolean
  busy?: boolean
  /** The action cannot run yet (still checking something); Cancel stays available. */
  confirmDisabled?: boolean
  error?: string
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
  returnFocusTo?: () => HTMLElement | null
  testId?: string
}

/** Confirm or cancel one action. Replaces `window.confirm` and the hand-built confirmation dialogs. */
export function ConfirmDialog({ title, description, confirmLabel, cancelLabel = i18n.t('ui.cancel'), danger = false, busy = false, confirmDisabled = false, error, onConfirm, onCancel, children, returnFocusTo, testId }: ConfirmDialogProps): ReactElement {
  return <Dialog title={title} description={description} size="sm" returnFocusTo={returnFocusTo} testId={testId} onClose={() => { if (!busy) onCancel() }}
    footer={<>
      <Button variant="secondary" autoFocus disabled={busy} onClick={onCancel}>{cancelLabel}</Button>
      <Button variant={danger ? 'danger' : 'primary'} loading={busy} disabled={busy || confirmDisabled} onClick={onConfirm}>{confirmLabel}</Button>
    </>}>
    {children}
    {error ? <p role="alert">{error}</p> : null}
  </Dialog>
}
