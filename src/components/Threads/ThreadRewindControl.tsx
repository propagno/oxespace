import { useState, type ReactElement } from 'react'
import { History, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '../../ui'

/**
 * Rewind the conversation to just before a user message, optionally to edit and
 * resend it. The later turns are set aside until the next message is sent, so a
 * Redo can still bring them back; the inline confirmation says how many.
 */
export function ThreadRewindControl({ laterTurns, disabled, onRewind, onEdit }: {
  /** Turns removed, including the one this message opened. */
  laterTurns: number
  disabled: boolean
  onRewind: (options: { restoreFiles: boolean }) => Promise<void>
  /** Rewinds, then puts the message back in the composer to change and send again. */
  onEdit?: (options: { restoreFiles: boolean }) => Promise<void>
}): ReactElement {
  const { t } = useTranslation('thread')
  const [mode, setMode] = useState<'rewind' | 'edit' | null>(null)
  const [restoreFiles, setRestoreFiles] = useState(true)
  const [busy, setBusy] = useState(false)
  if (!mode) return <span className="thread-rewind-triggers">
    {onEdit && <button type="button" className="thread-rewind-trigger" disabled={disabled} title={t('rewind.editTitle')} aria-label={t('rewind.edit')} onClick={() => setMode('edit')}><Pencil size={14} aria-hidden="true" /><span className="thread-rewind-label">{t('rewind.edit')}</span></button>}
    <button type="button" className="thread-rewind-trigger" disabled={disabled} title={t('rewind.hereTitle')} aria-label={t('rewind.here')} onClick={() => setMode('rewind')}><History size={14} aria-hidden="true" /><span className="thread-rewind-label">{t('rewind.here')}</span></button>
  </span>
  const run = mode === 'edit' && onEdit ? onEdit : onRewind
  return <div className="thread-rewind-confirm" role="group" aria-label={mode === 'edit' ? t('rewind.confirmEdit') : t('rewind.confirmRewind')}>
    <p>{mode === 'edit' ? t('rewind.editBody', { count: laterTurns }) : t('rewind.rewindBody', { count: laterTurns })}</p>
    <Checkbox checked={restoreFiles} onChange={event => setRestoreFiles(event.target.checked)} label={t('rewind.restoreFiles')} />
    <span>
      <button type="button" disabled={busy || disabled} onClick={() => { setBusy(true); void run({ restoreFiles }).finally(() => { setBusy(false); setMode(null) }) }}>{mode === 'edit' ? t('rewind.rewindAndEdit') : t('rewind.rewind')}</button>
      <button type="button" disabled={busy} onClick={() => setMode(null)}>{t('common.cancel')}</button>
    </span>
  </div>
}
