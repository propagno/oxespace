import { useState, type ReactElement } from 'react'
import { History } from 'lucide-react'

/**
 * Rewind the conversation to just before a user message. Destructive, so it is
 * a two-step inline confirmation that says how many turns will be removed.
 */
export function ThreadRewindControl({ laterTurns, disabled, onRewind }: {
  /** Turns removed, including the one this message opened. */
  laterTurns: number
  disabled: boolean
  onRewind: (options: { restoreFiles: boolean }) => Promise<void>
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [restoreFiles, setRestoreFiles] = useState(true)
  const [busy, setBusy] = useState(false)
  if (!open) return <button type="button" className="thread-rewind-trigger" disabled={disabled} title="Remove this message and everything after it from the conversation" onClick={() => setOpen(true)}><History size={12} aria-hidden="true" />Rewind to here</button>
  return <div className="thread-rewind-confirm" role="group" aria-label="Confirm rewind">
    <p>Removes this message and {laterTurns === 1 ? 'its reply' : `${laterTurns} turns`} from the conversation, in the provider's history too. This can't be undone.</p>
    <label><input type="checkbox" checked={restoreFiles} onChange={event => setRestoreFiles(event.target.checked)} /> Also restore files changed by those turns</label>
    <span>
      <button type="button" disabled={busy || disabled} onClick={() => { setBusy(true); void onRewind({ restoreFiles }).finally(() => { setBusy(false); setOpen(false) }) }}>Rewind</button>
      <button type="button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
    </span>
  </div>
}
