import { useEffect, useState } from 'react'
import type { ThreadFileHunk } from '../../../shared/types/thread'
import { TextArea } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

const MAX_SHOWN_LINES = 40

/** The note sent back to the agent about one change block: where it is, what it changed, and what to do. */
export function hunkComment(path: string, hunk: ThreadFileHunk, comment: string): string {
  const quote = (prefix: string, lines: string[]) => lines.slice(0, MAX_SHOWN_LINES).map(line => `${prefix}${line.replace(/\r$/, '')}`)
  const range = hunk.newLines.length ? `lines ${hunk.newStart + 1}–${hunk.newStart + hunk.newLines.length}` : `after line ${hunk.newStart}`
  return [`Review comment on \`${path}\` (${range}):`, '', '```diff', ...quote('-', hunk.oldLines), ...quote('+', hunk.newLines), '```', '', comment.trim(), ''].join('\n')
}

/**
 * The change blocks a turn made to one file, each undoable on its own or sent
 * back to the agent with a comment. Undo is refused by the main process when
 * the block is no longer in the file, so a stale view never overwrites work.
 */
export function ThreadHunkReview({ path, loadHunks, onUndoHunk, onComment, disabled }: {
  path: string
  loadHunks: () => Promise<ThreadFileHunk[]>
  onUndoHunk: (hunkId: string) => Promise<void>
  onComment: (text: string) => void
  disabled: boolean
}) {
  const [hunks, setHunks] = useState<ThreadFileHunk[] | null>(null)
  const [error, setError] = useState('')
  const [working, setWorking] = useState<string | null>(null)
  const [commenting, setCommenting] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const refresh = () => { void loadHunks().then(setHunks, cause => { setHunks([]); setError(humanizeError(cause, 'Could not load the changes.')) }) }
  // Loaded when the review opens and after each undo; the loader is an inline closure.
  useEffect(refresh, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (hunks === null) return <p className="thread-hunk-note" role="status">Loading changes…</p>
  return <div className="thread-hunk-review" aria-label={`Changes in ${path}`}>
    {error && <p role="alert" className="thread-change-error">{error}</p>}
    {!hunks.length && !error && <p className="thread-hunk-note">No change blocks to review here. New, binary or very large changes are undone as a whole file.</p>}
    {hunks.map((hunk, index) => {
      const shown = [...hunk.oldLines.map(line => ['-', line] as const), ...hunk.newLines.map(line => ['+', line] as const)]
      return <section key={hunk.id} className="thread-hunk" aria-label={`Change ${index + 1} of ${hunks.length}`}>
        <header><span>{hunk.newLines.length ? `Lines ${hunk.newStart + 1}–${hunk.newStart + hunk.newLines.length}` : `Removed after line ${hunk.newStart}`}</span>
          <button type="button" className="thread-change-view" disabled={disabled || working !== null} onClick={() => { setCommenting(commenting === hunk.id ? null : hunk.id); setComment('') }}>Comment</button>
          <button type="button" className="thread-change-view" disabled={disabled || working !== null} onClick={() => {
            setError(''); setWorking(hunk.id)
            void onUndoHunk(hunk.id).then(refresh, cause => setError(humanizeError(cause, 'Could not undo this change.'))).finally(() => setWorking(null))
          }}>{working === hunk.id ? 'Undoing…' : 'Undo change'}</button>
        </header>
        <pre>{shown.slice(0, MAX_SHOWN_LINES).map(([sign, line], row) => <span key={row} className={sign === '+' ? 'is-added' : 'is-removed'}>{sign} {line.replace(/\r$/, '')}{'\n'}</span>)}{shown.length > MAX_SHOWN_LINES && <span className="thread-hunk-more">… {shown.length - MAX_SHOWN_LINES} more lines</span>}</pre>
        {commenting === hunk.id && <form className="thread-hunk-comment" onSubmit={event => { event.preventDefault(); if (!comment.trim()) return; onComment(hunkComment(path, hunk, comment)); setCommenting(null); setComment('') }}>
          <TextArea aria-label="Comment for the agent" value={comment} maxLength={4000} placeholder="What should the agent change here?" onChange={event => setComment(event.target.value)} />
          <button type="submit" disabled={!comment.trim()}>Add to message</button>
        </form>}
      </section>
    })}
  </div>
}
