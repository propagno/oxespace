import { useState, type ReactElement } from 'react'
import { History, Pencil } from 'lucide-react'

/**
 * Rewind the conversation to just before a user message, optionally to edit and
 * resend it. Destructive, so it is a two-step inline confirmation that says how
 * many turns will be removed.
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
    {onEdit && <button type="button" className="thread-rewind-trigger" disabled={disabled} title="Rewind to before this message and edit it" onClick={() => setMode('edit')}><Pencil size={12} aria-hidden="true" />Edit</button>}
    <button type="button" className="thread-rewind-trigger" disabled={disabled} title="Remove this message and everything after it from the conversation" onClick={() => setMode('rewind')}><History size={12} aria-hidden="true" />Rewind to here</button>
  </span>
  const run = mode === 'edit' && onEdit ? onEdit : onRewind
  return <div className="thread-rewind-confirm" role="group" aria-label={mode === 'edit' ? 'Confirm edit' : 'Confirm rewind'}>
    <p>{mode === 'edit' ? 'To edit this message, it and ' : 'Removes this message and '}{laterTurns === 1 ? 'its reply' : `${laterTurns} turns`} {mode === 'edit' ? 'are removed from the conversation, in the provider\'s history too, and the text returns to the composer.' : 'from the conversation, in the provider\'s history too.'} This can't be undone.</p>
    <label><input type="checkbox" checked={restoreFiles} onChange={event => setRestoreFiles(event.target.checked)} /> Also restore files changed by those turns</label>
    <span>
      <button type="button" disabled={busy || disabled} onClick={() => { setBusy(true); void run({ restoreFiles }).finally(() => { setBusy(false); setMode(null) }) }}>{mode === 'edit' ? 'Rewind and edit' : 'Rewind'}</button>
      <button type="button" disabled={busy} onClick={() => setMode(null)}>Cancel</button>
    </span>
  </div>
}
