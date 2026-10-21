import { useState, type ReactElement } from 'react'
import { History, Pencil } from 'lucide-react'
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
  const [mode, setMode] = useState<'rewind' | 'edit' | null>(null)
  const [restoreFiles, setRestoreFiles] = useState(true)
  const [busy, setBusy] = useState(false)
  if (!mode) return <span className="thread-rewind-triggers">
    {onEdit && <button type="button" className="thread-rewind-trigger" disabled={disabled} title="Rewind to before this message and edit it" aria-label="Edit" onClick={() => setMode('edit')}><Pencil size={14} aria-hidden="true" /><span className="thread-rewind-label">Edit</span></button>}
    <button type="button" className="thread-rewind-trigger" disabled={disabled} title="Set this message and everything after it aside; your next message confirms it" aria-label="Rewind to here" onClick={() => setMode('rewind')}><History size={14} aria-hidden="true" /><span className="thread-rewind-label">Rewind to here</span></button>
  </span>
  const run = mode === 'edit' && onEdit ? onEdit : onRewind
  return <div className="thread-rewind-confirm" role="group" aria-label={mode === 'edit' ? 'Confirm edit' : 'Confirm rewind'}>
    <p>{mode === 'edit' ? 'To edit this message, it and ' : 'Rewinds to before this message: it and '}{laterTurns === 1 ? 'its reply' : `${laterTurns} turns`} {mode === 'edit' ? 'are set aside and the text returns to the composer.' : 'are set aside.'} They leave the conversation, and the provider's history, when you send your next message; until then, Redo brings them back.</p>
    <Checkbox checked={restoreFiles} onChange={event => setRestoreFiles(event.target.checked)} label="Also restore files changed by those turns" />
    <span>
      <button type="button" disabled={busy || disabled} onClick={() => { setBusy(true); void run({ restoreFiles }).finally(() => { setBusy(false); setMode(null) }) }}>{mode === 'edit' ? 'Rewind and edit' : 'Rewind'}</button>
      <button type="button" disabled={busy} onClick={() => setMode(null)}>Cancel</button>
    </span>
  </div>
}
