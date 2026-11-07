import { useState, type ReactElement, type ReactNode } from 'react'
import { i18n } from '../i18n'
import { Checkbox } from './Field'
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
  /**
   * An "I understand…" checkbox that must be ticked before the action runs (U1): the path for people who can't hold a
   * key or a pointer, where an irreversible action otherwise asks for a hold. Its words say what can't be undone.
   */
  acknowledge?: string
  error?: string
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
  returnFocusTo?: () => HTMLElement | null
  testId?: string
}

/** Confirm or cancel one action. Replaces `window.confirm` and the hand-built confirmation dialogs. */
export function ConfirmDialog({ title, description, confirmLabel, cancelLabel = i18n.t('ui.cancel'), danger = false, busy = false, confirmDisabled = false, acknowledge, error, onConfirm, onCancel, children, returnFocusTo, testId }: ConfirmDialogProps): ReactElement {
  const [acknowledged, setAcknowledged] = useState(false)
  const cancel = (): void => { if (!busy) onCancel() }
  return <Dialog title={title} description={description} size="sm" returnFocusTo={returnFocusTo} testId={testId} onClose={cancel}
    actions={{
      // Busy: Cancel keeps its focus and stays where it is; the dialog only closes once the action is done.
      cancel: { label: cancelLabel, onClick: cancel, focus: true, unavailable: busy },
      primary: { label: confirmLabel, danger, loading: busy, disabled: confirmDisabled || Boolean(acknowledge && !acknowledged), onClick: onConfirm }
    }}>
    {children}
    {acknowledge ? <Checkbox label={acknowledge} checked={acknowledged} onChange={event => setAcknowledged(event.currentTarget.checked)} /> : null}
    {error ? <p role="alert">{error}</p> : null}
  </Dialog>
}
