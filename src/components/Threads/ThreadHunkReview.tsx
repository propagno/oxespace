import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ThreadFileHunk } from '../../../shared/types/thread'
import { i18n } from '../../i18n'
import { EmptyState, ErrorState, LoadingState, TextArea } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

const MAX_SHOWN_LINES = 40

/** The note sent back to the agent about one change block: where it is, what it changed, and what to do. */
export function hunkComment(path: string, hunk: ThreadFileHunk, comment: string): string {
  const quote = (prefix: string, lines: string[]) => lines.slice(0, MAX_SHOWN_LINES).map(line => `${prefix}${line.replace(/\r$/, '')}`)
  const range = hunk.newLines.length ? i18n.t('thread:hunks.lines', { from: hunk.newStart + 1, to: hunk.newStart + hunk.newLines.length }) : i18n.t('thread:hunks.afterLine', { line: hunk.newStart })
  return [i18n.t('thread:hunks.comment', { path, range }), '', '```diff', ...quote('-', hunk.oldLines), ...quote('+', hunk.newLines), '```', '', comment.trim(), ''].join('\n')
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
  const { t } = useTranslation('thread')
  const [hunks, setHunks] = useState<ThreadFileHunk[] | null>(null)
  const [error, setError] = useState('')
  const [working, setWorking] = useState<string | null>(null)
  const [commenting, setCommenting] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const refresh = () => { void loadHunks().then(setHunks, cause => { setHunks([]); setError(humanizeError(cause, t('hunks.loadFailed'))) }) }
  // Loaded when the review opens and after each undo; the loader is an inline closure.
  useEffect(refresh, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (hunks === null) return <LoadingState label={t('hunks.loading')} />
  return <div className="thread-hunk-review" aria-label={t('hunks.label', { path })}>
    {error && <ErrorState compact title={error} />}
    {!hunks.length && !error && <EmptyState compact title={t('hunks.none')} />}
    {hunks.map((hunk, index) => {
      const shown = [...hunk.oldLines.map(line => ['-', line] as const), ...hunk.newLines.map(line => ['+', line] as const)]
      return <section key={hunk.id} className="thread-hunk" aria-label={t('hunks.block', { index: index + 1, total: hunks.length })}>
        <header><span>{hunk.newLines.length ? t('hunks.linesTitle', { from: hunk.newStart + 1, to: hunk.newStart + hunk.newLines.length }) : t('hunks.removedAfter', { line: hunk.newStart })}</span>
          <button type="button" className="thread-change-view" disabled={disabled || working !== null} onClick={() => { setCommenting(commenting === hunk.id ? null : hunk.id); setComment('') }}>{t('hunks.commentButton')}</button>
          <button type="button" className="thread-change-view" disabled={disabled || working !== null} onClick={() => {
            setError(''); setWorking(hunk.id)
            void onUndoHunk(hunk.id).then(refresh, cause => setError(humanizeError(cause, t('hunks.undoFailed')))).finally(() => setWorking(null))
          }}>{working === hunk.id ? t('hunks.undoing') : t('hunks.undo')}</button>
        </header>
        <pre>{shown.slice(0, MAX_SHOWN_LINES).map(([sign, line], row) => <span key={row} className={sign === '+' ? 'is-added' : 'is-removed'}>{sign} {line.replace(/\r$/, '')}{'\n'}</span>)}{shown.length > MAX_SHOWN_LINES && <span className="thread-hunk-more">{t('hunks.more', { count: shown.length - MAX_SHOWN_LINES })}</span>}</pre>
        {commenting === hunk.id && <form className="thread-hunk-comment" onSubmit={event => { event.preventDefault(); if (!comment.trim()) return; onComment(hunkComment(path, hunk, comment)); setCommenting(null); setComment('') }}>
          <TextArea aria-label={t('hunks.commentLabel')} value={comment} maxLength={4000} placeholder={t('hunks.commentPlaceholder')} onChange={event => setComment(event.target.value)} />
          <button type="submit" disabled={!comment.trim()}>{t('hunks.add')}</button>
        </form>}
      </section>
    })}
  </div>
}
